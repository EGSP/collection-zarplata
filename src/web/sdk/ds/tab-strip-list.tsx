/**
 * Список всех вкладок полосы: кнопка справа от ряда вкладок и список, который она открывает.
 * В списке главный экран и открытые вкладки в порядке полосы; активная выделена, у закрываемых
 * есть крестик. Выбор вкладки делает её активной и закрывает список.
 *
 * Вид списка зависит от точки перелома окна:
 *
 * | Точка | Вид | Набор стилей | Видно строк |
 * |---|---|---|---|
 * | `sm` | Выезжающая панель (`Drawer`, встроенный режим) на всю свободную высоту | `expressive` | все |
 * | `md` | Всплывающее окно под кнопкой | `productive` | 8 |
 * | `lg` и шире | Всплывающее окно под кнопкой | `productive` | 10 |
 *
 * Набор стилей задаёт размеры строки так же, как у меню оболочки на `sm`: в `productive` строка
 * 40 px (`componentSizes.md`), текст 14 px, иконка 16 px; в `expressive` строка 64 px
 * (`componentSizes.xl`), текст 16 px, иконка 24 px.
 *
 * Остальные строки прокручиваются внутри списка. Панель на `sm` выезжает в контейнере полосы
 * вкладок и страницы, как развёрнутое меню оболочки: нижний бар остаётся доступным. Её закрывают
 * шеврон в шапке, выбор вкладки (в том числе текущей) и Esc. Всплывающее окно закрывают выбор
 * вкладки, Esc и нажатие вне окна.
 *
 * Разметку и клавиши списка дают `useListBox` и `useOption` React Aria, всплывающее окно —
 * `usePopover`. Список не выбирает строки, а выполняет действие (`onAction`): так нажатие
 * на текущую вкладку тоже закрывает список. Активная строка отмечена `aria-current`.
 */
import { Button as AntButton, theme } from 'antd';
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { DismissButton, FocusScope, mergeProps, Overlay, useFocusRing, useHover, useListBox, useOption, usePopover } from 'react-aria';
import { Item, useListState, useOverlayTriggerState, type ListState, type Node, type OverlayTriggerState } from 'react-stately';
import { breakpointAtLeast, useBreakpoint } from './breakpoints';
import { Drawer, DrawerHeader, useDrawer } from './drawer';
import { Icons } from './icons';
import { componentSizes, iconSizes, spacing, type Breakpoint, type TypeSet, type TypeSetProperties } from './layout';
import { useOverflowShadows } from './overflow-shadows';
import { Text } from './text';
import { CloseMark, TabLabel, TabTooltip, useTruncated, type StripTab } from './tab-strip-parts';

/** Свойства списка вкладок: те же вкладки и команды, что у полосы. */
export interface TabStripListProperties {
    readonly tabs: ReadonlyArray<StripTab>;
    readonly selectedKey: string;
    readonly onSelect: (key: string) => void;
    readonly onClose: (key: string) => void;
}

/** Набор стилей и число видимых строк для точки окна. */
function listSize(point: Breakpoint): { readonly typeSet: TypeSet; readonly rows: number | undefined } {
    // Панель на `sm` занимает всю свободную высоту, поэтому число строк не ограничено.
    if (!breakpointAtLeast(point, 'md')) return { typeSet: 'expressive', rows: undefined };
    if (!breakpointAtLeast(point, 'lg')) return { typeSet: 'productive', rows: 8 };
    return { typeSet: 'productive', rows: 10 };
}

/** Высота строки списка и шапки панели в наборе стилей. */
function rowHeight(typeSet: TypeSet): number {
    return typeSet === 'expressive' ? componentSizes.xl : componentSizes.md;
}

const listTitle = 'Открытые вкладки';

/** Кнопка списка вкладок и сам список во всплывающем окне или выезжающей панели. */
export function TabStripList({ tabs, selectedKey, onSelect, onClose }: TabStripListProperties) {
    const point = useBreakpoint();
    const narrow = !breakpointAtLeast(point, 'md');
    const trigger = useRef<HTMLButtonElement>(null);
    const popover = useOverlayTriggerState({});
    const drawer = useDrawer(listTitle);
    // Смена ширины окна меняет вид списка: открытый вид другой ширины закрывается.
    useEffect(() => {
        if (narrow) popover.close();
        else drawer.close();
    }, [narrow]);
    const isOpen = narrow ? drawer.isOpen : popover.isOpen;
    const close = () => {
        popover.close();
        drawer.close();
    };
    const toggle = () => {
        if (isOpen) close();
        else if (narrow) drawer.open();
        else popover.open();
    };
    const choose = (key: string) => {
        close();
        onSelect(key);
    };
    const size = listSize(point);
    // Счётчик на кнопке: сколько ещё вкладок открыто помимо текущей. Постоянные вкладки без крестика,
    // как главный экран, не считаются: они есть всегда, и счётчик не говорил бы ничего нового.
    const others = tabs.filter((tab) => tab.closable === true && tab.key !== selectedKey).length;
    const list = <TabListBox tabs={tabs} selectedKey={selectedKey} typeSet={size.typeSet} rows={size.rows} onAction={choose} onClose={onClose} />;
    return (
        <>
            <ListButton
                ref={trigger}
                typeSet={size.typeSet}
                count={others}
                popup={narrow ? 'dialog' : 'listbox'}
                expanded={isOpen}
                onClick={toggle}
            />
            {narrow ? (
                <Drawer control={drawer} mode="inline">
                    <DrawerHeader typeSet={size.typeSet} title={listTitle} closeLabel="Закрыть список вкладок" onClose={close} />
                    {list}
                </Drawer>
            ) : popover.isOpen ? (
                <TabListPopover trigger={trigger} state={popover}>{list}</TabListPopover>
            ) : null}
        </>
    );
}

/** Свойства кнопки списка. */
interface ListButtonProperties extends TypeSetProperties {
    readonly ref: RefObject<HTMLButtonElement | null>;
    /** Число вкладок помимо текущей. */
    readonly count: number;
    readonly popup: 'dialog' | 'listbox';
    readonly expanded: boolean;
    readonly onClick: () => void;
}

/**
 * Кнопка списка: иконка и в скобках число вкладок помимо текущей, обычным цветом текста. Высотой
 * она равна полосе: 40 px в `productive` и 64 px в `expressive`. Кнопка `Button` дизайн-системы
 * здесь не подходит: у размера `xl` отступы рассчитаны на подпись-действие, а не на короткое число.
 */
function ListButton({ ref, typeSet = 'productive', count, popup, expanded, onClick }: ListButtonProperties) {
    const expressive = typeSet === 'expressive';
    return (
        <AntButton
            ref={ref}
            type="text"
            icon={<Icons.tabList style={{ fontSize: expressive ? iconSizes.lg : iconSizes.sm }} />}
            aria-label={`Список вкладок, ещё ${count}`}
            aria-haspopup={popup}
            aria-expanded={expanded}
            onClick={onClick}
            style={{ height: rowHeight(typeSet), paddingInline: expressive ? spacing[5] : spacing[4], gap: spacing[3], borderRadius: 0 }}
        >
            <Text typeSet={typeSet}>({count})</Text>
        </AntButton>
    );
}

/**
 * Всплывающее окно под кнопкой списка. `usePopover` располагает его, закрывает по Esc и нажатию
 * вне окна; область фокуса переводит фокус в список и возвращает его кнопке после закрытия.
 * Слой окна ниже подсказок Ant Design: иначе подсказка обрезанной строки оказалась бы под окном.
 */
function TabListPopover({ trigger, state, children }: { readonly trigger: RefObject<HTMLButtonElement | null>; readonly state: OverlayTriggerState; readonly children: ReactNode }) {
    const { token } = theme.useToken();
    const popover = useRef<HTMLDivElement>(null);
    const { popoverProps, underlayProps } = usePopover({ triggerRef: trigger, popoverRef: popover, placement: 'bottom end', offset: spacing[2] }, state);
    return (
        <Overlay>
            <div {...underlayProps} style={{ position: 'fixed', inset: 0, zIndex: popoverLayer - 1 }} />
            <div
                {...popoverProps}
                ref={popover}
                style={{
                    ...popoverProps.style,
                    zIndex: popoverLayer,
                    width: 320,
                    maxWidth: 'calc(100vw - 32px)',
                    background: token.colorBgElevated,
                    borderRadius: token.borderRadiusLG,
                    boxShadow: token.boxShadowSecondary,
                    overflow: 'hidden',
                }}
            >
                <FocusScope restoreFocus>
                    <DismissButton onDismiss={state.close} />
                    {children}
                    <DismissButton onDismiss={state.close} />
                </FocusScope>
            </div>
        </Overlay>
    );
}

/** Слой всплывающего окна: выше страницы и выезжающих панелей, ниже подсказок Ant Design (1070). */
const popoverLayer = 1050;

/** Свойства списка строк. Набор стилей задаёт размеры строк. */
interface TabListBoxProperties extends TypeSetProperties {
    readonly tabs: ReadonlyArray<StripTab>;
    readonly selectedKey: string;
    /** Видимых строк; без ограничения список занимает высоту места, как в панели на `sm`. */
    readonly rows: number | undefined;
    readonly onAction: (key: string) => void;
    readonly onClose: (key: string) => void;
}

/**
 * Список строк вкладок. Высота равна видимым строкам или месту в панели, остальные прокручиваются внутри, тени
 * у краёв показывают скрытые строки. При открытии фокус стоит на активной вкладке.
 */
function TabListBox({ tabs, selectedKey, typeSet = 'productive', rows, onAction, onClose }: TabListBoxProperties) {
    const frame = useRef<HTMLDivElement>(null);
    const list = useRef<HTMLDivElement>(null);
    useOverflowShadows(frame, list, 'vertical');
    const state = useListState<StripTab>({
        items: tabs,
        children: (tab) => <Item key={tab.key} textValue={tab.title}>{tab.title}</Item>,
        selectionMode: 'none',
    });
    const { listBoxProps } = useListBox({ 'aria-label': listTitle, autoFocus: true, shouldFocusWrap: true, onAction: (key) => onAction(String(key)) }, state, list);
    // `autoFocus` переводит фокус в список, а здесь он переходит на строку активной вкладки.
    useEffect(() => {
        state.selectionManager.setFocusedKey(selectedKey);
    }, []);
    return (
        <div ref={frame} style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div {...listBoxProps} ref={list} style={{ flex: 1, minHeight: 0, maxHeight: rows === undefined ? undefined : rows * rowHeight(typeSet), overflowY: 'auto', outline: 'none' }}>
                {[...state.collection].map((item) => (
                    <TabOption key={item.key} item={item} state={state} typeSet={typeSet} active={item.key === selectedKey} onClose={onClose} />
                ))}
            </div>
        </div>
    );
}

/** Свойства строки списка. */
interface TabOptionProperties extends TypeSetProperties {
    readonly item: Node<StripTab>;
    readonly state: ListState<StripTab>;
    readonly active: boolean;
    readonly onClose: (key: string) => void;
}

/**
 * Строка списка: иконка, подпись с подсказкой при обрезке и крестик у закрываемой вкладки.
 * Высота, размер текста и иконки следуют набору стилей.
 */
function TabOption({ item, state, typeSet = 'productive', active, onClose }: TabOptionProperties) {
    const { token } = theme.useToken();
    const element = useRef<HTMLDivElement>(null);
    const labelRef = useRef<HTMLSpanElement>(null);
    const tab = item.value;
    const { optionProps } = useOption({ key: item.key }, state, element);
    const { hoverProps, isHovered } = useHover({});
    const { focusProps, isFocusVisible } = useFocusRing();
    const truncated = useTruncated(labelRef, `${tab?.title ?? ''}:${active}`);
    if (tab === null) return null;
    const closable = tab.closable === true;
    const close = () => onClose(tab.key);
    const onKeyDown = (event: { readonly key: string; preventDefault: () => void }) => {
        if (event.key !== 'Delete' || !closable) return;
        event.preventDefault();
        close();
    };
    return (
        <TabTooltip title={tab.title} shown={truncated && (isHovered || isFocusVisible)}>
            <div
                {...mergeProps(optionProps, hoverProps, focusProps, { onKeyDown })}
                ref={element}
                aria-current={active ? 'page' : undefined}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: spacing[3],
                    height: rowHeight(typeSet),
                    paddingInlineStart: spacing[5],
                    paddingInlineEnd: closable ? spacing[3] : spacing[5],
                    background: active ? token.controlItemBgActive : isHovered ? token.controlItemBgHover : undefined,
                    outline: isFocusVisible ? `2px solid ${token.colorPrimary}` : 'none',
                    outlineOffset: -2,
                    cursor: 'pointer',
                    userSelect: 'none',
                }}
            >
                {tab.icon !== undefined && (
                    <span style={{ display: 'inline-flex', flex: 'none', fontSize: typeSet === 'expressive' ? iconSizes.lg : iconSizes.sm }}>{tab.icon}</span>
                )}
                <span style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                    <TabLabel typeSet={typeSet} title={tab.title} strong={active} labelRef={labelRef} />
                </span>
                {closable && <CloseMark typeSet={typeSet} onClose={close} />}
            </div>
        </TabTooltip>
    );
}
