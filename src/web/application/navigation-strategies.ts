/**
 * Стратегии боковой панели: как панель показывается и что делает кнопка Switcher при данной
 * точке перелома окна. Оболочка выбирает стратегию и только выполняет её решения, поэтому новый режим,
 * например для телефона, добавляется сюда записью, а не условиями внутри оболочки.
 *
 * Стратегия чистая: она не хранит состояние, а описывает поведение по одному признаку, развёрнута
 * ли панель. Признак хранит оболочка, и при смене стратегии он сбрасывается к значению новой
 * стратегии по умолчанию.
 */
import { breakpointAtLeast, useBreakpoint } from '../sdk/ds/breakpoints';
import type { Breakpoint } from '../sdk/ds/layout';

/**
 * Ширины боковой панели по Carbon UI Shell: развёрнутая панель с заголовками и полоса иконок.
 * В полосе пункт узнаётся по иконке, а заголовок виден в подсказке.
 */
export const navigationWidths = { expanded: 256, rail: 48 } as const;

/** Как выглядит панель при данном состоянии. */
export interface NavigationPresentation {
    /** Закреплённая панель слева от страницы: развёрнута или свёрнута в полосу иконок. */
    readonly docked: 'expanded' | 'rail';
    /** Развёрнутая панель выдвинута поверх страницы. */
    readonly overlay: boolean;
}

/** Режим боковой панели для окна с точки `from` и шире. */
export interface NavigationStrategy {
    /** Имя режима; по нему оболочка замечает смену стратегии. */
    readonly name: string;
    /** Точка окна, с которой действует стратегия. Шкала та же, что у сетки. */
    readonly from: Breakpoint;
    /** Развёрнута ли панель, пока пользователь не нажал Switcher. */
    readonly expandedByDefault: boolean;
    /**
     * Сворачивается ли развёрнутая панель после перехода на страницу или открытия подсистемы.
     * Временная панель поверх страницы мешает работать, а закреплённая остаётся как была.
     */
    readonly collapsesOnNavigation: boolean;
    readonly present: (expanded: boolean) => NavigationPresentation;
    /** Подсказка Switcher: что произойдёт по нажатию. */
    readonly switcherTitle: (expanded: boolean) => string;
}

/**
 * Узкое окно: панель всегда остаётся полосой иконок, а Switcher выдвигает развёрнутую панель
 * поверх страницы (overlay). Страница при этом не сжимается, и её сетка не перестраивается.
 */
const overlayStrategy: NavigationStrategy = {
    name: 'overlay',
    from: 'sm',
    expandedByDefault: false,
    collapsesOnNavigation: true,
    present: (expanded) => ({ docked: 'rail', overlay: expanded }),
    switcherTitle: (expanded) => (expanded ? 'Закрыть меню' : 'Открыть меню'),
};

/**
 * Широкое окно: панель развёрнута, а Switcher сворачивает её в полосу иконок и разворачивает
 * обратно, сдвигая страницу (push).
 *
 * Действует с точки окна `max` (1584 px). Только с неё развёрнутой панели хватает места, чтобы
 * страница рядом оставалась на точке `lg` и формы получали сетку на 16 колонок. На старых мониторах
 * 1024–1280 px, ноутбуках 1366 px и окнах 1440 px действует overlay: страница рядом с полосой
 * иконок остаётся на `lg`, а развёрнутая панель доступна поверх неё.
 */
const pushStrategy: NavigationStrategy = {
    name: 'push',
    from: 'max',
    expandedByDefault: true,
    collapsesOnNavigation: false,
    present: (expanded) => ({ docked: expanded ? 'expanded' : 'rail', overlay: false }),
    switcherTitle: (expanded) => (expanded ? 'Свернуть меню' : 'Развернуть меню'),
};

/** Стратегии от узкого окна к широкому. Действует последняя, до точки которой окно доросло. */
const navigationStrategies: ReadonlyArray<NavigationStrategy> = [overlayStrategy, pushStrategy];

/**
 * Стратегия боковой панели для текущей точки окна; меняется вместе с ней. Хук берёт точку
 * ближайшего `BreakpointContainer`, поэтому оболочка должна стоять в контейнере окна, а не
 * в контейнере страницы: ширина области страницы сама зависит от панели.
 */
export function useNavigationStrategy(): NavigationStrategy {
    const point = useBreakpoint();
    return navigationStrategies.findLast((strategy) => breakpointAtLeast(point, strategy.from)) ?? overlayStrategy;
}
