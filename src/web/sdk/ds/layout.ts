/**
 * Значения раскладки дизайн-системы: шкала отступов, точки перелома сетки, число колонок и зазоры.
 * Правила взяты из Carbon (2x Grid и Spacing); как ими пользоваться, описано в разделе
 * «Компоненты и раскладка» документации.
 *
 * Модуль единственный источник этих чисел. Точки перелома нужны в CSS (`@container`), а условие
 * контейнерного запроса не принимает CSS-переменные, поэтому таблицу стилей сетки модуль собирает
 * сам из констант ниже и один раз добавляет в документ. Отдельный CSS-файл повторял бы числа.
 */

/**
 * Шкала отступов Carbon: шаг → пиксели. Стек и зазоры сетки принимают только шаги шкалы, поэтому
 * расстояния на экранах берутся из одного ряда и не расходятся на соседних блоках.
 */
export const spacing = {
    1: 2,
    2: 4,
    3: 8,
    4: 12,
    5: 16,
    6: 24,
    7: 32,
    8: 40,
    9: 48,
    10: 64,
    11: 80,
    12: 96,
    13: 160,
} as const;

/** Шаг шкалы отступов: 1 — 2 px, 5 — 16 px, 7 — 32 px. */
export type SpacingStep = keyof typeof spacing;

/** Точки перелома сетки от узкой к широкой. Их ширины — в `breakpointWidths`. */
export const breakpoints = ['sm', 'md', 'lg', 'xlg', 'max'] as const;

/** Точка перелома сетки. */
export type Breakpoint = (typeof breakpoints)[number];

/**
 * Наименьшая ширина контейнера сетки для каждой точки, как у Carbon. Ширина считается
 * по контейнеру, а не по окну: так сетка учитывает боковое меню и модальные окна.
 */
export const breakpointWidths: { readonly [Point in Breakpoint]: number } = { sm: 0, md: 672, lg: 1056, xlg: 1312, max: 1584 };

/** Число колонок сетки на каждой точке: 4 на узком контейнере, 8 на среднем, 16 начиная с `lg`. */
export const gridColumns: { readonly [Point in Breakpoint]: number } = { sm: 4, md: 8, lg: 16, xlg: 16, max: 16 };

/**
 * Режим зазора между колонками, как в Carbon: `wide` — 32 px, обычная раскладка; `narrow` —
 * 16 px, плотная раскладка; `condensed` — 1 px, блоки стоят почти вплотную и читаются как одно целое.
 */
export type GridGutter = 'wide' | 'narrow' | 'condensed';

/** Зазор между колонками в пикселях для каждого режима. */
export const gutterWidths: { readonly [Gutter in GridGutter]: number } = { wide: spacing[7], narrow: spacing[5], condensed: 1 };

/**
 * Модель ширины страницы из Carbon. `product` ограничивает ширину содержимого точкой `max`
 * и прижимает его влево: форма на широком мониторе не растягивается и поля не уходят от подписей.
 * `high-density` занимает всю ширину: спискам, таблицам и рабочим местам полезно всё место.
 */
export type PageModel = 'product' | 'high-density';

/** Имя контейнера сетки в контейнерных запросах. */
const containerName = 'layout-grid';

/** CSS-классы раскладки. Компоненты ставят их на свои элементы; правила задаёт `layoutStyleSheet`. */
export const layoutClasses = {
    gridContainer: 'layout-grid-container',
    grid: 'layout-grid',
    subgrid: 'layout-subgrid',
    column: 'layout-column',
    productPage: 'layout-product-page',
} as const;

/** CSS-переменная с размещением колонки на точке: значение `grid-column`, например `span 4`. */
export function columnVariable(point: Breakpoint): string {
    return `--layout-column-${point}`;
}

/**
 * Таблица стилей сетки. Колонка и вложенная сетка получают размещение из своих CSS-переменных
 * по точке, на которой сейчас находится контейнер; каждая следующая точка переопределяет предыдущую.
 *
 * Вложенная сетка (subgrid) стоит прямо внутри колонки. Колонка тогда не создаёт своего блока
 * (`display: contents`), а размещение получает вложенная сетка: иначе subgrid не унаследовал бы
 * линии родителя. Переменные колонки при этом наследуются вложенной сетке по дереву документа.
 */
function layoutStyleSheet(): string {
    const { gridContainer, grid, subgrid, column, productPage } = layoutClasses;
    const placed = `.${column}, .${column}:has(> .${subgrid}) > .${subgrid}`;
    const rules = breakpoints.map((point) => {
        const body = `.${grid} { grid-template-columns: repeat(${gridColumns[point]}, minmax(0, 1fr)); }\n${placed} { grid-column: var(${columnVariable(point)}); }`;
        return point === 'sm' ? body : `@container ${containerName} (min-width: ${breakpointWidths[point]}px) {\n${body}\n}`;
    });
    return [
        `.${gridContainer} { container: ${containerName} / inline-size; }`,
        `.${grid} { display: grid; column-gap: var(--layout-gutter); row-gap: var(--layout-row-gap); }`,
        `.${subgrid} { display: grid; grid-template-columns: subgrid; column-gap: var(--layout-gutter); row-gap: var(--layout-row-gap); }`,
        // Нулевая минимальная ширина не даёт длинному содержимому раздвинуть колонку шире её доли.
        `.${column} { min-width: 0; }`,
        `.${column}:has(> .${subgrid}) { display: contents; }`,
        // Колонка, компонент в которой ничего не вывел, не занимает места: иначе в строке остался бы пропуск.
        `.${column}:empty { display: none; }`,
        ...rules,
        `.${productPage} { max-width: ${breakpointWidths.max}px; }`,
    ].join('\n');
}

// Таблица добавляется при первом импорте модуля, один раз на документ.
if (typeof document !== 'undefined' && document.getElementById('layout-styles') === null) {
    const element = document.createElement('style');
    element.id = 'layout-styles';
    element.textContent = layoutStyleSheet();
    document.head.append(element);
}
