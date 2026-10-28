/**
 * Раскладка колонок таблицы дизайн-системы: размер колонки, составные колонки и выбор схемы
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
 * Схема отображения: колонки по порядку показа. Строка — обычная колонка, массив — составная:
 * её поля стоят друг под другом в одной колонке, а заголовок составлен из их названий.
 *
 * ```ts
 * ['code', 'name'] // две колонки
 * [['code', 'name'], 'size'] // код над названием, затем размер
 * ```
 *
 * Колонки, которых нет в схеме, выводятся после названных по одной: значение не пропадает
 * из таблицы оттого, что схему писали раньше, чем появилась колонка.
 */
export type TableLayout = ReadonlyArray<string | ReadonlyArray<string>>;

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
 * Колонки таблицы по схеме: каждая группа — одна колонка на экране. Имена, которых нет среди
 * `keys`, пропускаются, а не названные схемой колонки идут после названных в порядке `keys`.
 * Без схемы каждая колонка — отдельная группа.
 */
export function columnGroups(keys: ReadonlyArray<string>, layout: TableLayout | undefined): ReadonlyArray<ReadonlyArray<string>> {
    if (layout === undefined) return keys.map((key) => [key]);
    const known = new Set(keys);
    const placed = new Set<string>();
    const groups = layout.flatMap((item) => {
        const group = (typeof item === 'string' ? [item] : item).filter((key) => known.has(key) && !placed.has(key));
        for (const key of group) placed.add(key);
        return group.length === 0 ? [] : [group];
    });
    return [...groups, ...keys.filter((key) => !placed.has(key)).map((key) => [key])];
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
 * Трек колонки для `grid-template-columns`. К минимуму в знаках добавляются внутренние отступы
 * ячейки с двух сторон: минимум описывает само значение, а не ячейку вокруг него.
 */
export function columnTrack(size: ColumnSize | ControlColumnSize): string {
    if (size === 'control') return 'var(--data-table-row-height)';
    const minimum = `calc(${size.minimum}ch + 2 * var(--data-table-cell-padding))`;
    const weight = size.weight ?? 0;
    return weight > 0 ? `minmax(${minimum}, ${weight}fr)` : minimum;
}
