/**
 * Полоса вкладок дизайн-системы в виде contained из Carbon Tabs. Вкладки высотой 40 px (`md`
 * шкалы `componentSizes`, на `sm` 64 px) стоят в один ряд, который прокручивается по горизонтали. Справа
 * закреплена кнопка списка всех вкладок (`TabStripList`).
 *
 * ```tsx
 * <TabStrip
 *     aria-label="Открытые вкладки"
 *     tabs={[{ key: 'home', title: 'Главная', icon: <Icons.home />, iconOnly: true }, { key: '7', title: 'Продажа', closable: true }]}
 *     selectedKey={selectedKey}
 *     onSelect={setSelectedKey}
 *     onClose={close}
 * />
 * ```
 *
 * Полоса показывает только вкладки и сообщает о выборе и закрытии. Страницы вкладок выводит
 * владелец полосы: панель вкладок React Aria размонтировала бы страницы скрытых вкладок.
 *
 * **Вид.** Полоса залита (`colorFillSecondary`), неактивные вкладки прозрачны и разделены линией,
 * фон активной совпадает с фоном страницы (`colorBgLayout`), поэтому активная вкладка и страница
 * читаются одним целым. Активную вкладку отмечают линия 2 px основного цвета по верхнему краю
 * и жирная подпись. Подписи всех вкладок обычного цвета текста.
 *
 * **Малый экран.** На `sm` полоса в наборе `expressive`: высота 64 px, квадратные вкладки и кнопка
 * списка той же высоты, текст 16 px, иконки 24 px. В ряду только вкладки без крестика (главный
 * экран) и текущая, растянутая на свободное место; остальные открываются из списка. Кнопки
 * прокрутки на `sm` не выводятся. Кнопка списка во всех режимах показывает в скобках, сколько ещё
 * вкладок открыто помимо текущей.
 *
 * **Клавиатура.** Разметку и клавиши дают `useTabList` и `useTab` React Aria, как у Carbon Tabs:
 * полоса — одна остановка Tab, стрелки влево и вправо переводят фокус по кругу, Enter и пробел
 * активируют вкладку в фокусе (`keyboardActivation: 'manual'`), Delete закрывает её.
 *
 * **Прокрутка.** Ряд прокручивается тремя способами: перетаскиванием мышью (`useDragGesture`),
 * кнопками со стрелками у краёв и колесом мыши. Мышью вкладка выбирается при отпускании кнопки
 * (`shouldSelectOnPressUp`), поэтому полосу можно тянуть за вкладку: после перетаскивания
 * дальше порога выбор отменяется. Активная вкладка прокручивается в видимую часть ряда.
 */
import { theme } from 'antd';
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type WheelEvent } from 'react';
import { mergeProps, useFocusRing, useHover, useTab, useTabList } from 'react-aria';
import { Item, useTabListState, type Node, type TabListState } from 'react-stately';
import { Button } from './button';
import { useDragGesture } from './drag-gesture';
import { Icons } from './icons';
import { breakpointAtLeast, useBreakpoint } from './breakpoints';
import { componentSizes, iconSizes, spacing, type TypeSet, type TypeSetProperties } from './layout';
import { useOverflowShadows } from './overflow-shadows';
import { isRendered } from './rendered';
import { CloseMark, stripTabMaxWidth, TabLabel, TabTooltip, useTruncated, type StripTab } from './tab-strip-parts';
import { TabStripList } from './tab-strip-list';

export type { StripTab } from './tab-strip-parts';

/** Свойства полосы вкладок. */
export interface TabStripProperties {
    /** Вкладки в порядке полосы. */
    readonly tabs: ReadonlyArray<StripTab>;
    /** Ключ активной вкладки. */
    readonly selectedKey: string;
    /** Пользователь выбрал вкладку в полосе или в списке. */
    readonly onSelect: (key: string) => void;
    /** Пользователь закрыл вкладку крестиком или клавишей Delete. Убирает вкладку владелец. */
    readonly onClose: (key: string) => void;
    /** Название полосы для диктора. */
    readonly 'aria-label': string;
}

/** Полоса вкладок с прокруткой и списком всех вкладок. */
export function TabStrip({ tabs, selectedKey, onSelect, onClose, 'aria-label': label }: TabStripProperties) {
    const { token } = theme.useToken();
    // На `sm` полоса крупная (`expressive`, 64 px) и показывает только постоянные вкладки и текущую:
    // остальные доступны из списка, а прокручивать узкий ряд неудобно.
    const narrow = !breakpointAtLeast(useBreakpoint(), 'md');
    const typeSet: TypeSet = narrow ? 'expressive' : 'productive';
    const shown = narrow ? tabs.filter((tab) => tab.closable !== true || tab.key === selectedKey) : tabs;
    const frame = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    useOverflowShadows(frame, scroller);
    const edges = useScrollEdges(scroller);
    const drag = useDragGesture({
        onDrag: (delta) => {
            if (scroller.current !== null) scroller.current.scrollLeft -= delta.x;
        },
    });

    const state = useTabListState<StripTab>({
        items: shown,
        children: (tab) => <Item key={tab.key} textValue={tab.title}>{tab.title}</Item>,
        selectedKey,
        // Отпускание кнопки мыши после перетаскивания полосы вкладку не выбирает.
        onSelectionChange: (key) => {
            if (key !== null && !drag.wasDragged()) onSelect(String(key));
        },
    });
    const { tabListProps } = useTabList({ 'aria-label': label, keyboardActivation: 'manual' }, state, scroller);

    // Активная вкладка прокручивается в видимую часть ряда, в том числе после выбора в списке.
    useLayoutEffect(() => {
        const area = scroller.current;
        const tab = area?.querySelector<HTMLElement>(`[data-tab-key="${CSS.escape(selectedKey)}"]`);
        if (area === null || area === undefined || tab === null || tab === undefined || !isRendered(area)) return;
        revealInScroller(area, tab);
    }, [selectedKey, tabs.length]);

    // Колесо мыши прокручивает ряд по горизонтали: вертикальной прокрутки у полосы нет.
    const onWheel = (event: WheelEvent<HTMLDivElement>) => {
        if (scroller.current !== null && Math.abs(event.deltaY) > Math.abs(event.deltaX)) scroller.current.scrollLeft += event.deltaY;
    };
    // Кнопка со стрелкой сдвигает ряд на ширину его видимой части.
    const scrollPage = (direction: 1 | -1) => scroller.current?.scrollBy({ left: direction * scroller.current.clientWidth, behavior: 'smooth' });
    // Кнопки прокрутки не получают фокус: с клавиатуры вкладки обходят стрелками, и ряд
    // прокручивается к вкладке в фокусе сам. Кнопки нужны тем, кому перетаскивание неудобно.
    return (
        // Полоса залита серым, а активная вкладка цветом фона страницы: так она продолжает страницу
        // под собой и отделяется от остальных вкладок, как у вкладок вида contained в Carbon.
        <div style={{ display: 'flex', flex: 'none', height: stripHeight(typeSet), background: token.colorFillSecondary }}>
            {!narrow && edges.start && (
                <Fixed>
                    <Button type="text" size="md" tabIndex={-1} icon={<Icons.scrollBackward />} aria-label="Прокрутить вкладки к началу" onClick={() => scrollPage(-1)} />
                </Fixed>
            )}
            <div ref={frame} style={{ position: 'relative', flex: narrow ? '1 1 auto' : '0 1 auto', minWidth: 0 }}>
                <style>{`
                    .tab-strip-scroller { scrollbar-width: none; overscroll-behavior: contain; }
                    .tab-strip-scroller::-webkit-scrollbar { display: none; }
                `}</style>
                <div
                    {...mergeProps(tabListProps, drag.gestureProps, { onWheel })}
                    ref={scroller}
                    className="tab-strip-scroller"
                    style={{ height: '100%', overflowX: 'auto', overflowY: 'hidden', cursor: drag.isDragging ? 'grabbing' : undefined }}
                >
                    {/* Обёртка по ширине ряда: по смене её размера тени и кнопки узнают о новых вкладках. */}
                    <div style={{ display: 'flex', width: narrow ? '100%' : 'max-content', height: '100%' }}>
                        {[...state.collection].map((item) => (
                            <StripTabItem key={item.key} item={item} state={state} typeSet={typeSet} stretch={narrow} onClose={(key) => { if (!drag.wasDragged()) onClose(key); }} />
                        ))}
                    </div>
                </div>
            </div>
            {!narrow && edges.end && (
                <Fixed>
                    <Button type="text" size="md" tabIndex={-1} icon={<Icons.scrollForward />} aria-label="Прокрутить вкладки к концу" onClick={() => scrollPage(1)} />
                </Fixed>
            )}
            {/* Свободное место между рядом и кнопкой списка: кнопка закреплена у правого края. */}
            {!narrow && <div style={{ flex: 1 }} />}
            <Fixed>
                <TabStripList tabs={tabs} selectedKey={selectedKey} onSelect={onSelect} onClose={onClose} />
            </Fixed>
        </div>
    );
}

/**
 * Несжимаемая ячейка ряда для кнопок прокрутки и списка. Без неё длинный ряд вкладок сжимал бы
 * квадратные кнопки: ширина flex-элемента по умолчанию уступает соседям.
 */
function Fixed({ children }: { readonly children: ReactNode }) {
    return <div style={{ display: 'flex', flex: 'none' }}>{children}</div>;
}

/** Высота полосы и квадратных кнопок в ней: 40 px в `productive`, 64 px в `expressive`. */
function stripHeight(typeSet: TypeSet): number {
    return typeSet === 'expressive' ? componentSizes.xl : componentSizes.md;
}

/** Свойства вкладки полосы. */
interface StripTabItemProperties extends TypeSetProperties {
    readonly item: Node<StripTab>;
    readonly state: TabListState<StripTab>;
    /** Вкладка с подписью занимает всё свободное место ряда, как текущая вкладка на `sm`. */
    readonly stretch: boolean;
    readonly onClose: (key: string) => void;
}

/** Одна вкладка полосы. */
function StripTabItem({ item, state, typeSet = 'productive', stretch, onClose }: StripTabItemProperties) {
    const { token } = theme.useToken();
    const element = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLSpanElement>(null);
    const tab = item.value;
    const { tabProps, isSelected } = useTab({ key: item.key, shouldSelectOnPressUp: true }, state, element);
    const { hoverProps, isHovered } = useHover({});
    const { focusProps, isFocusVisible } = useFocusRing();
    const truncated = useTruncated(labelRef, `${tab?.title ?? ''}:${isSelected}`);
    if (tab === null) return null;
    const iconOnly = tab.iconOnly === true;
    const stretched = stretch && !iconOnly;
    const closable = tab.closable === true;
    const close = () => onClose(tab.key);
    const onKeyDown = (event: { readonly key: string; preventDefault: () => void }) => {
        if (event.key !== 'Delete' || !closable) return;
        event.preventDefault();
        close();
    };
    return (
        <TabTooltip title={tab.title} shown={(iconOnly || truncated) && (isHovered || isFocusVisible)}>
            <div
                {...mergeProps(tabProps, hoverProps, focusProps, { onKeyDown })}
                ref={element}
                data-tab-key={tab.key}
                aria-label={iconOnly ? tab.title : undefined}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: iconOnly ? 'center' : undefined,
                    gap: spacing[3],
                    boxSizing: 'border-box',
                    flex: stretched ? '1 1 auto' : 'none',
                    minWidth: 0,
                    height: '100%',
                    width: iconOnly ? stripHeight(typeSet) : undefined,
                    maxWidth: stretched ? undefined : stripTabMaxWidth,
                    fontSize: typeSet === 'expressive' ? iconSizes.lg : iconSizes.sm,
                    paddingInlineStart: iconOnly ? 0 : spacing[5],
                    paddingInlineEnd: iconOnly ? 0 : closable ? spacing[3] : spacing[5],
                    // Неактивные вкладки прозрачны и показывают заливку полосы, при наведении темнее.
                    background: isSelected ? token.colorBgLayout : isHovered ? token.colorFill : undefined,
                    // Линии тенью, а не рамкой: рамка изменила бы размеры вкладки. У активной — линия
                    // по верхнему краю, у неактивных — разделитель справа.
                    boxShadow: isSelected ? `inset 0 2px 0 ${token.colorPrimary}` : `inset -1px 0 0 ${token.colorBorderSecondary}`,
                    color: token.colorText,
                    outline: isFocusVisible ? `2px solid ${token.colorPrimary}` : 'none',
                    outlineOffset: -2,
                    cursor: 'pointer',
                    userSelect: 'none',
                }}
            >
                {iconOnly ? tab.icon : <TabLabel typeSet={typeSet} title={tab.title} strong={isSelected} labelRef={labelRef} />}
                {closable && <CloseMark typeSet={typeSet} onClose={close} />}
            </div>
        </TabTooltip>
    );
}

/** Сдвигает прокрутку ряда так, чтобы вкладка стала видна целиком. */
function revealInScroller(area: HTMLElement, tab: HTMLElement) {
    const areaBox = area.getBoundingClientRect();
    const tabBox = tab.getBoundingClientRect();
    if (tabBox.left < areaBox.left) area.scrollLeft -= areaBox.left - tabBox.left;
    else if (tabBox.right > areaBox.right) area.scrollLeft += tabBox.right - areaBox.right;
}

/**
 * Есть ли скрытые вкладки слева и справа от видимой части ряда. По ним показываются кнопки
 * прокрутки. Пересчёт идёт при прокрутке и при смене размеров ряда и его содержимого.
 */
function useScrollEdges(scroller: RefObject<HTMLDivElement | null>): { readonly start: boolean; readonly end: boolean } {
    const [edges, setEdges] = useState({ start: false, end: false });
    useLayoutEffect(() => {
        const area = scroller.current;
        if (area === null) return;
        const update = () => {
            if (!isRendered(area)) return;
            // Округление: при дробном масштабе страницы прокрутка до края даёт не ровно ноль.
            const start = area.scrollLeft > 1;
            const end = area.scrollLeft + area.clientWidth < area.scrollWidth - 1;
            setEdges((previous) => (previous.start === start && previous.end === end ? previous : { start, end }));
        };
        update();
        area.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(area);
        if (area.firstElementChild !== null) observer.observe(area.firstElementChild);
        return () => {
            area.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, [scroller]);
    return edges;
}
