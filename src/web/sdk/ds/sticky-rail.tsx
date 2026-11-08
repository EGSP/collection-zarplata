import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { breakpointAtLeast, useBreakpoint } from './breakpoints';
import { isRendered } from './rendered';
import { spacing, type Breakpoint, type SpacingStep } from './layout';

/** Поддерживается верхняя граница. Остальные направления отложены до конкретной потребности. */
export interface StickyRailProperties {
    readonly from: Breakpoint;
    readonly offset?: SpacingStep;
    readonly children: ReactNode;
}

/** Прилипает внутри колонки к области прокрутки вкладки. Высокое содержимое прокручивается обычно. */
export function StickyRail({ from, offset = 5, children }: StickyRailProperties) {
    const reference = useRef<HTMLDivElement>(null);
    const point = useBreakpoint();
    const [fits, setFits] = useState(false);
    const top = spacing[offset];
    useLayoutEffect(() => {
        const element = reference.current;
        if (element === null) return;
        let scroller = element.parentElement;
        while (scroller !== null && !/(auto|scroll|hidden|overlay)/u.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
        const container = scroller;
        const measure = () => {
            // Скрытая вкладка не сообщает нулевую высоту как новую геометрию.
            if (!isRendered(element)) return;
            setFits(element.getBoundingClientRect().height <= (container?.clientHeight ?? document.documentElement.clientHeight) - top);
        };
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        observer.observe(container ?? document.documentElement);
        measure();
        return () => observer.disconnect();
    }, [top]);
    const active = fits && breakpointAtLeast(point, from);
    return <div ref={reference} data-sticky-rail={active ? 'active' : 'inactive'}
        style={{ position: active ? 'sticky' : 'static', top: active ? top : undefined, alignSelf: 'start' }}>{children}</div>;
}
