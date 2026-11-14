/**
 * Выезжающая панель дизайн-системы. Все выезжающие панели приложения, включая развёрнутое меню
 * оболочки, строятся на ней, поэтому выезд, затемнение, закрытие и фокус устроены одинаково.
 *
 * В Carbon отдельного Drawer нет. Ближайший аналог — `SidePanel` из Carbon for IBM Products
 * с режимами `SlideOver` (поверх страницы) и `SlideIn` (рядом со страницей), а правила плавающих
 * панелей описаны у правой панели UI Shell: открыта только одна, закрывается по Esc, фокус
 * возвращается к кнопке открытия. Выезд снизу на узком месте — наше расширение: в Carbon
 * панель на малом экране открывается сбоку поверх содержимого.
 *
 * Панель собирается из четырёх частей:
 *
 * ```tsx
 * <DrawerScope>                              // корень приложения: знает об открытой панели
 *     <DrawerContainer style={...}>          // область, внутри которой панели выезжают
 *         <Page />
 *     </DrawerContainer>
 * </DrawerScope>
 *
 * function Page() {
 *     const filters = useDrawer('Фильтры');  // состояние панели и команды открытия и закрытия
 *     return <>
 *         <Button onClick={filters.open}>Фильтры</Button>
 *         <Drawer control={filters}>…</Drawer>
 *     </>;
 * }
 * ```
 *
 * Панель закрывается только явно: командой `close` или клавишей Esc. Нажатие вне панели её не
 * закрывает, как и модальное окно: введённое в панели не теряется от случайного нажатия.
 * Пока панель открыта, другая не открывается: `open` возвращает `false` и пишет в консоль, какая
 * панель мешает. Так закрытие панели всегда остаётся решением пользователя или экрана.
 *
 * Панель выводится не на месте объявления, а в слой ближайшего `DrawerContainer`. Поэтому она
 * не прокручивается вместе со страницей и не обрезается блоком, в котором объявлена.
 */
import { theme } from 'antd';
import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { FocusScope, mergeProps, useDialog } from 'react-aria';
import { createPortal } from 'react-dom';
import { useBreakpoint } from './breakpoints';
import { Button } from './button';
import { Icons } from './icons';
import { breakpoints, componentSizes, iconSizes, spacing, type Breakpoint, type TypeSetProperties } from './layout';
import { Text } from './text';

/** Сторона, с которой выезжает панель. */
export type DrawerSide = 'left' | 'right' | 'bottom';

/**
 * Сторона выезда по точкам перелома ближайшего `BreakpointContainer`. Действует сторона самой
 * широкой указанной точки, не шире текущей, как у CSS `min-width`. Заданное экраном дополняет
 * умолчание `drawerDefaultPlacement`: `{ md: 'left' }` оставляет на `sm` выезд снизу.
 */
export type DrawerPlacement = { readonly [Point in Breakpoint]?: DrawerSide };

/** На малых экранах панель выезжает снизу, на остальных справа, как `SidePanel` в Carbon. */
export const drawerDefaultPlacement = { sm: 'bottom', md: 'right' } as const satisfies DrawerPlacement;

/** Сторона выезда для точки: самая широкая заданная точка, не шире текущей. */
function sideAt(placement: DrawerPlacement, point: Breakpoint): DrawerSide {
    const merged: DrawerPlacement = { ...drawerDefaultPlacement, ...placement };
    const reached = breakpoints.slice(0, breakpoints.indexOf(point) + 1);
    return reached.map((candidate) => merged[candidate]).findLast((side) => side !== undefined) ?? 'bottom';
}

// ─── Владелец открытой панели ───────────────────────────────────────────────

/**
 * Владелец знает, какая панель открыта, и не даёт открыть вторую. `claim` вызывает панель
 * перед открытием: при успехе получает функцию, которая снимает её с учёта при закрытии,
 * а `null`, если открыта другая панель.
 */
interface DrawerOwner {
    readonly claim: (label: string) => (() => void) | null;
}

/** Владелец ближайшего `DrawerScope`. Вне него панели друг о друге не знают. */
const DrawerOwnerContext = createContext<DrawerOwner | null>(null);

/**
 * Владелец выезжающих панелей. Стоит один раз в корне приложения, рядом с контейнером окна
 * для точек перелома: правило «открыта одна панель» действует на всё окно, а не на вкладку.
 * Поэтому, пока открыта панель страницы, меню оболочки не выдвигается, и наоборот.
 */
export function DrawerScope({ children }: { readonly children: ReactNode }) {
    // Владелец не хранит состояние React: смена открытой панели не должна перерисовывать приложение.
    const [owner] = useState<DrawerOwner>(() => {
        let current: { readonly label: string } | null = null;
        return {
            claim: (label) => {
                if (current !== null) {
                    // Предупреждение объясняет при отладке, почему кнопка открытия ничего не сделала.
                    console.warn(`Панель «${label}» не открыта: уже открыта панель «${current.label}». Сначала закройте её.`);
                    return null;
                }
                const entry = { label };
                current = entry;
                return () => {
                    if (current === entry) current = null;
                };
            },
        };
    });
    return <DrawerOwnerContext.Provider value={owner}>{children}</DrawerOwnerContext.Provider>;
}

/** Состояние панели и команды для неё. Создаётся `useDrawer` и передаётся в `Drawer`. */
export interface DrawerControl {
    /** Название панели: подпись для экранного диктора и имя в предупреждении владельца. */
    readonly label: string;
    readonly isOpen: boolean;
    /** Открывает панель. Возвращает `false`, если открыта другая панель: эта тогда не открывается. */
    readonly open: () => boolean;
    readonly close: () => void;
}

/**
 * Панель экрана: хранит, открыта ли она, и спрашивает владельца перед открытием. Экран не заводит
 * для панели своё состояние и не следит за соседними панелями. Если экран закрывается вместе
 * с открытой панелью, она снимается с учёта и не мешает открыть следующую.
 */
export function useDrawer(label: string): DrawerControl {
    const owner = useContext(DrawerOwnerContext);
    const [isOpen, setOpen] = useState(false);
    // Снятие с учёта хранится в ссылке: open и close вызываются из обработчиков, а не при отрисовке.
    const release = useRef<(() => void) | null>(null);
    useEffect(() => () => {
        release.current?.();
        release.current = null;
    }, []);
    const open = () => {
        if (release.current !== null) return true;
        const claimed = owner === null ? () => {} : owner.claim(label);
        if (claimed === null) return false;
        release.current = claimed;
        setOpen(true);
        return true;
    };
    const close = () => {
        release.current?.();
        release.current = null;
        setOpen(false);
    };
    return { label, isOpen, open, close };
}

// ─── Контейнер ──────────────────────────────────────────────────────────────

/** Слой ближайшего `DrawerContainer`. `null` вне контейнеров: тогда панель выезжает в окне браузера. */
const DrawerLayerContext = createContext<HTMLElement | null>(null);

/** Свойства контейнера: стиль его блока, например высота или видимость. */
export interface DrawerContainerProperties {
    readonly style?: CSSProperties;
    readonly children: ReactNode;
}

/**
 * Область, внутри которой выезжают панели. Контейнер выводит блок с `position: relative` и над
 * содержимым слой для панелей. Слой пропускает нажатия, пока в нём нет панели, поэтому содержимое
 * под ним работает как обычно.
 *
 * Контейнеры стоят там, где раскладка делится на области: вся раскладка приложения, область
 * справа от боковой панели (полоса вкладок и страница) и область страницы каждой вкладки.
 * Панель скрытой вкладки скрывается вместе с её областью.
 */
export function DrawerContainer({ style, children }: DrawerContainerProperties) {
    const [layer, setLayer] = useState<HTMLElement | null>(null);
    return (
        <div style={{ ...style, position: 'relative' }}>
            <DrawerLayerContext.Provider value={layer}>{children}</DrawerLayerContext.Provider>
            <div ref={setLayer} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1000 }} />
        </div>
    );
}

// ─── Панель ─────────────────────────────────────────────────────────────────

/** Свойства выезжающей панели. */
export interface DrawerProperties {
    /** Состояние и команды панели из `useDrawer`. Esc внутри панели вызывает `control.close`. */
    readonly control: DrawerControl;
    /**
     * `inline` — панель выезжает внутри своего контейнера без затемнения, остальной интерфейс
     * доступен (ближе к `SlideIn` Carbon, но содержимое под панелью не сжимается).
     * `overlay` — панель с затемнением под ней: нажатия вне панели не доходят до интерфейса
     * и панель не закрывают, Tab не выходит из панели (`SlideOver` с `includeOverlay`).
     * По умолчанию `overlay`.
     */
    readonly mode?: 'inline' | 'overlay';
    /** Сторона выезда по точкам перелома; дополняет `drawerDefaultPlacement`. */
    readonly placement?: DrawerPlacement;
    /** Ширина панели, выезжающей сбоку. По умолчанию 320 px, не шире контейнера. */
    readonly width?: number | string;
    /** Высота панели, выезжающей снизу. По умолчанию панель занимает контейнер по высоте. */
    readonly height?: number | string;
    readonly children: ReactNode;
}

/**
 * Выезжающая панель. Закрытая панель не выводится. Открытая:
 *
 * - появляется сразу у стороны из `placement`, без анимации выезда (решение пользователя);
 * - получает фокус: первый доступный элемент внутри или саму панель;
 * - закрывается по Esc внутри панели или командой `close`; нажатие вне панели её не закрывает;
 * - после закрытия возвращает фокус элементу, который был в фокусе при открытии, если фокус
 *   остался в панели или потерян.
 *
 * Фокус ведёт `FocusScope` из React Aria, роль и подпись окна задаёт `useDialog`. У панели роль
 * `dialog`: обработчики клавиш форм считают её открытым окном и уступают ей Esc.
 */
export function Drawer({ control, mode = 'overlay', placement = {}, width = 320, height = '100%', children }: DrawerProperties) {
    const layer = useContext(DrawerLayerContext);
    const side = sideAt(placement, useBreakpoint());
    if (!control.isOpen) return null;
    const panel = <OpenDrawer label={control.label} overlay={mode === 'overlay'} side={side} size={side === 'bottom' ? height : width} fixed={layer === null} onClose={control.close}>{children}</OpenDrawer>;
    return createPortal(panel, layer ?? document.body);
}

/** Открытая панель: затемнение и сама панель в области фокуса. */
function OpenDrawer({ label, overlay, side, size, fixed, onClose, children }: {
    readonly label: string;
    readonly overlay: boolean;
    readonly side: DrawerSide;
    readonly size: number | string;
    /** Контейнера нет: панель стоит в окне браузера и не прокручивается вместе с документом. */
    readonly fixed: boolean;
    /** Закрытие по Esc. */
    readonly onClose: () => void;
    readonly children: ReactNode;
}) {
    const { token } = theme.useToken();
    return (
        <div style={{ position: fixed ? 'fixed' : 'absolute', inset: 0, pointerEvents: 'none', zIndex: fixed ? 1000 : undefined, overflow: 'hidden' }}>
            {/* Затемнение перехватывает нажатия, но панель не закрывает: закрытие только явное. */}
            {overlay && <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'auto', background: token.colorBgMask }} />}
            {/*
              * Область фокуса переводит фокус в панель при открытии и возвращает его при закрытии.
              * Встроенная панель (`inline`) фокус не удерживает: остальной интерфейс доступен, и Tab
              * уходит из панели дальше по странице. Панель с затемнением удерживает Tab внутри.
              */}
            <FocusScope contain={overlay} restoreFocus autoFocus>
                <DrawerPanel label={label} overlay={overlay} side={side} size={size} onClose={onClose} background={token.colorBgContainer} shadow={token.boxShadowSecondary}>
                    {children}
                </DrawerPanel>
            </FocusScope>
        </div>
    );
}

/**
 * Блок панели внутри области фокуса. `useDialog` даёт роль `dialog` и фокусирует саму панель,
 * если внутри нет доступного элемента.
 *
 * Esc остаётся своим, а не `useOverlay` из React Aria: открытый список или календарь Ant Design
 * закрывается своим Esc и помечает событие обработанным, а React Aria об этих контролах не знает.
 * Панель закрывается, только если Esc никто не обработал.
 */
function DrawerPanel({ label, overlay, side, size, onClose, background, shadow, children }: {
    readonly label: string;
    readonly overlay: boolean;
    readonly side: DrawerSide;
    readonly size: number | string;
    readonly onClose: () => void;
    readonly background: string;
    readonly shadow: string;
    readonly children: ReactNode;
}) {
    const panel = useRef<HTMLDivElement>(null);
    const { dialogProps } = useDialog({ 'aria-label': label }, panel);
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
    };
    const sideStyle: CSSProperties = side === 'bottom'
        ? { left: 0, right: 0, bottom: 0, height: size, maxHeight: '100%' }
        : { top: 0, bottom: 0, [side]: 0, width: size, maxWidth: '100%' };
    return (
        <div
            {...mergeProps(dialogProps, { onKeyDown })}
            ref={panel}
            aria-modal={overlay ? true : undefined}
            className="drawer-panel"
            data-side={side}
            style={{ position: 'absolute', ...sideStyle, display: 'flex', flexDirection: 'column', overflow: 'auto', outline: 'none', pointerEvents: 'auto', background, boxShadow: shadow }}
        >
            {children}
        </div>
    );
}

// ─── Шапка ──────────────────────────────────────────────────────────────────

/** Свойства шапки панели. */
export interface DrawerHeaderProperties extends TypeSetProperties {
    /** Название панели. */
    readonly title: string;
    /** Подпись кнопки закрытия для диктора, например «Закрыть меню». */
    readonly closeLabel: string;
    readonly onClose: () => void;
}

/**
 * Первая строка панели: название слева и кнопка закрытия справа. Кнопка — шеврон вниз
 * (`Icons.closePanel`): панель на `sm` выезжает снизу, и кнопка сворачивает её обратно к бару.
 * Высота строки и кнопки — 40 px в наборе `productive` и 64 px в `expressive`, иконка 16 и 24 px.
 * На `sm` панели выводят шапку в `expressive`, как строки своих списков и меню.
 */
export function DrawerHeader({ title, closeLabel, onClose, typeSet = 'productive' }: DrawerHeaderProperties) {
    const { token } = theme.useToken();
    const expressive = typeSet === 'expressive';
    return (
        <div style={{ display: 'flex', alignItems: 'center', flex: 'none', gap: spacing[3], height: expressive ? componentSizes.xl : componentSizes.md, paddingInlineStart: spacing[5], borderBlockEnd: `1px solid ${token.colorBorderSecondary}` }}>
            <span style={{ flex: 1, minWidth: 0 }}>
                <Text typeSet={typeSet} strong ellipsis>{title}</Text>
            </span>
            <Button
                type="text"
                size={expressive ? 'xl' : 'md'}
                icon={<Icons.closePanel style={{ fontSize: expressive ? iconSizes.lg : iconSizes.sm }} />}
                aria-label={closeLabel}
                onClick={onClose}
            />
        </div>
    );
}
