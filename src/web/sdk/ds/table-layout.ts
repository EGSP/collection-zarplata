/**
 * Раскладка колонок таблицы дизайн-системы: размер колонки, строки и группы схемы и выбор схемы
 * отображения по точке перелома. Модуль не рисует таблицу: его правила общие для `DataTable`
 * и для табличной части формы, которой нужен тот же порядок колонок для обхода с клавиатуры.
 *
 * Размер колонки задаётся не в пикселях, а наименьшей шириной в знаках и долей остатка:
 *
 * ```ts
 * { minimum: 8 }               // код: 8 знаков, не растёт
 * { minimum: 16, weight: 2 }   // название: не уже 16 знаков, две доли остатка
 * ```
 *
 * Браузер раскладывает такие колонки сам (`minmax(…, Nfr)` в CSS Grid): остаток ширины делится
 * по долям, а колонка не становится уже своего минимума. Если минимумов больше, чем места,
 * таблица прокручивается по горизонтали, а не сжимает значения.
 */
import { breakpoints, type Breakpoint } from './layout';

/**
 * Размер колонки. `minimum` — наименьшая ширина значения в знаках (единица `ch`) без внутренних
 * отступов ячейки. `weight` — доля остатка ширины; при 0 (по умолчанию) колонка не растёт
 * и всегда равна своему минимуму. Так короткие коды, даты и суммы не забирают место у названий.
 */
export interface ColumnSize {
    readonly minimum: number;
    readonly weight?: number | undefined;
}

/**
 * Размер служебной колонки: квадрат высотой в строку без внутренних отступов, например колонка
 * флажка выбора, раскрытия строки или кнопки удаления.
 */
export type ControlColumnSize = 'control';

/**
 * Группа схемы: поля стоят друг под другом в одной колонке, а заголовок составлен из их названий.
 * Так на узком месте код встаёт над названием, а не занимает отдельную колонку.
 */
export interface TableGroup {
    readonly group: ReadonlyArray<string>;
}

/** Колонка строки схемы: имя колонки таблицы либо группа полей. */
export type TableLayoutColumn = string | TableGroup;

/**
 * Строка схемы: колонки, которые стоят рядом. Строка занимает всю ширину таблицы, и у каждой
 * строки свои колонки, поэтому в первой строке длинное значение может занять всю ширину,
 * а суммы встать второй строкой и не сжиматься.
 */
export interface TableLine {
    readonly line: ReadonlyArray<TableLayoutColumn>;
}

/**
 * Схема отображения: строки одной записи таблицы сверху вниз. Строка и группа названы явно,
 * поэтому по схеме сразу видно, что стоит рядом, а что друг под другом.
 *
 * ```ts
 * [{ line: ['code', 'name', 'total'] }]                        // три колонки рядом
 * [{ line: [{ group: ['code', 'name'] }, 'total'] }]           // код над названием, затем итог
 * [{ line: ['document'] }, { line: ['cash', 'cashless'] }]     // документ, под ним две суммы
 * ```
 *
 * Пустая схема (`[]`) выводит колонки по одной в одну строку, при нехватке места таблица
 * прокручивается с тенями. Колонки, которых нет в схеме, выводятся по одной в конце последней
 * строки: значение не пропадает из таблицы оттого, что схему писали раньше, чем появилась колонка.
 */
export type TableLayout = ReadonlyArray<TableLine>;

/**
 * Схемы отображения по точкам перелома. Схема действует от своей точки и шире, как правило
 * CSS `min-width`: `{ lg: …, max: … }` — схема `lg` на `lg` и `xlg`, схема `max` на `max`.
 * Уже самой узкой названной точки схемы нет, и таблица выводит колонки по одной с прокруткой.
 */
export type TableLayouts = { readonly [Point in Breakpoint]?: TableLayout };

/** Схема для точки: самая широкая из названных точек, не шире текущей. */
export function tableLayoutAt(layouts: TableLayouts | undefined, point: Breakpoint): TableLayout | undefined {
    if (layouts === undefined) return undefined;
    let found: TableLayout | undefined;
    for (const candidate of breakpoints) {
        found = layouts[candidate] ?? found;
        if (candidate === point) break;
    }
    return found;
}

/**
 * Колонки таблицы по схеме: строки, в строке колонки, в колонке имена полей сверху вниз. Имена,
 * которых нет среди `keys`, и повторы пропускаются, а не названные схемой колонки идут по одной
 * в конце последней строки в порядке `keys`. Без схемы и при пустой схеме строка одна, и каждая
 * колонка в ней отдельная. Пустые строки не выводятся.
 */
export function columnLines(keys: ReadonlyArray<string>, layout: TableLayout | undefined): ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>> {
    if (layout === undefined || layout.length === 0) return [keys.map((key) => [key])];
    const known = new Set(keys);
    const placed = new Set<string>();
    const lines = layout.map(({ line }) => line.flatMap((item) => {
        const group = (typeof item === 'string' ? [item] : item.group).filter((key) => known.has(key) && !placed.has(key));
        for (const key of group) placed.add(key);
        return group.length === 0 ? [] : [group];
    }));
    const rest = keys.filter((key) => !placed.has(key)).map((key) => [key]);
    const filled = lines.filter((line) => line.length > 0);
    if (filled.length === 0) return [rest];
    return [...filled.slice(0, -1), [...filled[filled.length - 1]!, ...rest]];
}

/** Порядок колонок на экране: строки сверху вниз, в строке слева направо, в группе сверху вниз. */
export function screenOrder(lines: ReadonlyArray<ReadonlyArray<ReadonlyArray<string>>>): ReadonlyArray<string> {
    return lines.flat(2);
}

/**
 * Размер составной колонки: самый большой минимум и самая большая доля её полей. Поля стоят
 * друг под другом, поэтому колонке нужна ширина самого широкого из них, а не сумма.
 */
export function groupSize(sizes: ReadonlyArray<ColumnSize | ControlColumnSize>): ColumnSize | ControlColumnSize {
    const regular = sizes.filter((size): size is ColumnSize => size !== 'control');
    if (regular.length === 0) return 'control';
    return {
        minimum: Math.max(...regular.map((size) => size.minimum)),
        weight: Math.max(...regular.map((size) => size.weight ?? 0)),
    };
}

/**
 * Наименьшая ширина колонки в CSS: минимум значения в знаках и отступы ячейки. По сумме минимумов
 * таблица задаёт ширину области строк, не измеряя содержимое.
 */
export function trackMinimum(size: ColumnSize | ControlColumnSize): string {
    if (size === 'control') return 'var(--data-table-row-height)';
    return `calc(${size.minimum}ch + 2 * var(--data-table-cell-padding))`;
}

/**
 * Трек колонки для `grid-template-columns`. К минимуму в знаках добавляются внутренние отступы
 * ячейки с двух сторон: минимум описывает само значение, а не ячейку вокруг него.
 */
export function columnTrack(size: ColumnSize | ControlColumnSize): string {
    if (size === 'control') return 'var(--data-table-row-height)';
    const minimum = trackMinimum(size);
    const weight = size.weight ?? 0;
    return weight > 0 ? `minmax(${minimum}, ${weight}fr)` : minimum;
}
