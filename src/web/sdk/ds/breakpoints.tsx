/**
 * Точка перелома контейнера для решений в коде компонента: что показать и как себя вести на данной
 * ширине. Колонки сетки получают ширину по точке в CSS через контейнерные запросы, а этот модуль
 * даёт ту же точку компонентам. Шкала общая (`breakpoints` и `breakpointWidths` из `layout.ts`),
 * поэтому CSS и код делят точки по одним и тем же ширинам.
 *
 * Точку задаёт ближайший `BreakpointContainer` выше по дереву. Контейнеры ставятся там, где
 * раскладка делится на области: окно браузера в корне приложения и область страницы вкладки.
 * Модальное окно ничего не измеряет и сразу задаёт точку `sm` (`of="fixed"`): все окна приложения
 * уже области вкладки, и таблица в окне раскладывается как на узком месте.
 * Компонент не знает, в каком контейнере стоит, и только спрашивает `useBreakpoint()`:
 *
 * ```tsx
 * <BreakpointContainer of="window">          // корень приложения
 *     <Shell />                               // useBreakpoint() — точка окна
 *     <BreakpointContainer style={...}>       // область страницы вкладки
 *         <Page />                            // useBreakpoint() — точка страницы
 *     </BreakpointContainer>
 * </BreakpointContainer>
 * ```
 */
import { createContext, useContext, useLayoutEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { breakpoints, breakpointWidths, type Breakpoint } from './layout';

/**
 * Точка ближайшего контейнера. Вне контейнеров действует самая узкая точка: компонент, которому
 * не сказали ширину, раскладывается как на узком месте и не выходит за его границы.
 */
const BreakpointContext = createContext<Breakpoint>('sm');

/** Точка для ширины: самая широкая из тех, чья наименьшая ширина не больше заданной. */
function breakpointOf(width: number): Breakpoint {
    return breakpoints.findLast((point) => width >= breakpointWidths[point]) ?? 'sm';
}

/** Точка ближайшего `BreakpointContainer`. Обновляется, когда контейнер пересекает порог шкалы. */
export function useBreakpoint(): Breakpoint {
    return useContext(BreakpointContext);
}

/**
 * Не уже ли текущая точка, чем `point`. Удобно для условий вида «с `lg` и шире»:
 * `breakpointAtLeast(useBreakpoint(), 'lg')`.
 */
export function breakpointAtLeast(current: Breakpoint, point: Breakpoint): boolean {
    return breakpoints.indexOf(current) >= breakpoints.indexOf(point);
}

/**
 * Свойства контейнера. `of="window"` измеряет окно браузера и не выводит своего элемента.
 * `of="fixed"` ничего не измеряет и не выводит элемента: он сразу задаёт точку `point`, например
 * `sm` для модального окна. Без `of` контейнер выводит блок со стилем `style` и измеряет ширину
 * его содержимого без полей, как контейнерный запрос CSS.
 */
export type BreakpointContainerProperties =
    | { readonly of: 'window'; readonly children: ReactNode }
    | { readonly of: 'fixed'; readonly point: Breakpoint; readonly children: ReactNode }
    | { readonly of?: 'element'; readonly style?: CSSProperties; readonly children: ReactNode };

/** Граница области раскладки: сообщает вложенным компонентам свою точку перелома. */
export function BreakpointContainer(properties: BreakpointContainerProperties) {
    if (properties.of === 'window') return <WindowContainer>{properties.children}</WindowContainer>;
    if (properties.of === 'fixed') return <FixedContainer point={properties.point}>{properties.children}</FixedContainer>;
    return <ElementContainer style={properties.style}>{properties.children}</ElementContainer>;
}

/** Медиазапросы порогов шкалы, кроме `sm`: от нуля окно шире всегда. */
const windowQueries = breakpoints.filter((point) => breakpointWidths[point] > 0).map((point) => `(min-width: ${breakpointWidths[point]}px)`);

/** Подписка на пересечение окном любого порога шкалы. */
function subscribeToWindow(onChange: () => void): () => void {
    const lists = windowQueries.map((query) => window.matchMedia(query));
    for (const list of lists) list.addEventListener('change', onChange);
    return () => {
        for (const list of lists) list.removeEventListener('change', onChange);
    };
}

/**
 * Точка окна по медиазапросам, а не по `window.innerWidth`: медиазапрос сообщает о смене порога сам,
 * и отрисовка происходит только при смене точки, а не при каждом изменении размера.
 */
function windowBreakpoint(): Breakpoint {
    return breakpoints.findLast((point) => window.matchMedia(`(min-width: ${breakpointWidths[point]}px)`).matches) ?? 'sm';
}

function WindowContainer({ children }: { readonly children: ReactNode }) {
    const point = useSyncExternalStore(subscribeToWindow, windowBreakpoint);
    return <BreakpointContext.Provider value={point}>{children}</BreakpointContext.Provider>;
}

/**
 * Заданная точка, но не шире точки внешнего контейнера: область внутри не бывает шире той,
 * в которой стоит. Так окно с точкой `lg` на узком экране всё равно получит узкую точку.
 */
function FixedContainer({ point, children }: { readonly point: Breakpoint; readonly children: ReactNode }) {
    const outer = useContext(BreakpointContext);
    const narrower = breakpointAtLeast(point, outer) ? outer : point;
    return <BreakpointContext.Provider value={narrower}>{children}</BreakpointContext.Provider>;
}

/** Ширина содержимого элемента без полей: по ней же считает контейнерный запрос CSS. */
function contentWidth(element: HTMLElement): number {
    const style = getComputedStyle(element);
    return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
}

function ElementContainer({ style, children }: { readonly style: CSSProperties | undefined; readonly children: ReactNode }) {
    // До первого измерения действует точка внешнего контейнера: она ближе к правде, чем самая узкая.
    const outer = useContext(BreakpointContext);
    const [element, setElement] = useState<HTMLDivElement | null>(null);
    const [point, setPoint] = useState<Breakpoint | null>(null);
    useLayoutEffect(() => {
        if (element === null) return;
        // Скрытый элемент (неактивная вкладка) имеет ширину 0. Точку он не меняет: иначе страница
        // перестраивалась бы на узкую раскладку при каждом переключении вкладок.
        const measure = (width: number) => {
            if (width > 0) setPoint(breakpointOf(width));
        };
        measure(contentWidth(element));
        const observer = new ResizeObserver(([entry]) => {
            if (entry !== undefined) measure(entry.contentRect.width);
        });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element]);
    return (
        <div ref={setElement} style={style}>
            <BreakpointContext.Provider value={point ?? outer}>{children}</BreakpointContext.Provider>
        </div>
    );
}
