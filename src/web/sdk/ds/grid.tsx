/**
 * Сетка и колонка дизайн-системы по правилам Carbon 2x Grid: 16 колонок, точки перелома по ширине
 * контейнера, вложенная сетка как subgrid. Компоненты внутри колонки не задают себе ширину
 * и внешние отступы: размер области определяет колонка, а компонент заполняет её целиком.
 *
 * ```tsx
 * <Grid>
 *     <Column span={{ md: 8, lg: 10 }}>Оплата</Column>
 *     <Column span={{ md: 8, lg: 6 }}>Рассрочка</Column>
 * </Grid>
 * ```
 */
import type { CSSProperties, ReactNode } from 'react';
import { breakpoints, columnVariable, gridColumns, gutterWidths, layoutClasses, type Breakpoint, type GridGutter } from './layout';

/** Свойства сетки. */
export interface GridProperties {
    /**
     * Зазор между колонками: `wide` (32 px, по умолчанию), `narrow` (16 px) или `condensed` (1 px).
     * Вложенная сетка задаёт свой режим так же: родительский она не наследует.
     */
    readonly gutter?: GridGutter | undefined;
    /**
     * Зазор между строками равен зазору между колонками. При `false` строки стоят вплотную:
     * так выглядят блоки, которые читаются одним целым.
     */
    readonly rowGap?: boolean | undefined;
    /**
     * Вложенная сетка продолжает линии родительской (CSS subgrid): колонки внутри неё выравниваются
     * по колонкам страницы. Такая сетка ставится прямо внутрь `Column`: любой промежуточный блок,
     * например карточка, разрывает наследование линий. Сетка внутри карточки — обычная сетка без
     * `subgrid`: её точки перелома считаются по ширине карточки.
     */
    readonly subgrid?: boolean | undefined;
    readonly children?: ReactNode;
}

/**
 * Сетка из колонок. Обычная сетка сама служит контейнером для точек перелома: число колонок
 * и размеры `Column` внутри неё зависят от её ширины, а не от ширины окна. Поэтому одна и та же
 * раскладка правильно ведёт себя во вкладке, рядом с боковым меню и в модальном окне.
 */
export function Grid({ gutter = 'wide', rowGap = true, subgrid = false, children }: GridProperties) {
    const gap = `${gutterWidths[gutter]}px`;
    const style = { '--layout-gutter': gap, '--layout-row-gap': rowGap ? gap : '0px' } as CSSProperties;
    if (subgrid) return <div className={layoutClasses.subgrid} style={style}>{children}</div>;
    // Контейнерный запрос не может опрашивать сам элемент сетки, поэтому контейнером служит обёртка.
    return (
        <div className={layoutClasses.gridContainer}>
            <div className={layoutClasses.grid} style={style}>{children}</div>
        </div>
    );
}

/**
 * Число колонок: одно для всех точек или по точкам. Не названная точка берёт значение
 * ближайшей более узкой: `{ md: 8, lg: 4 }` — вся строка на `sm`, 8 колонок на `md`, 4 начиная с `lg`.
 */
export type ColumnCount = number | { readonly [Point in Breakpoint]?: number };

/** Свойства колонки. */
export interface ColumnProperties {
    /**
     * Сколько колонок занимает область. По умолчанию — всю строку. Число больше колонок на точке
     * уменьшается до всей строки: на `sm` в строке 4 колонки, на `md` — 8.
     */
    readonly span?: ColumnCount | undefined;
    /** Сколько колонок пропустить перед областью, например чтобы поставить панель по центру. По умолчанию 0. */
    readonly offset?: ColumnCount | undefined;
    /** Скрыть колонку вместе с её местом в строке, например когда компонент внутри ничего не вывел. */
    readonly hidden?: boolean | undefined;
    readonly children?: ReactNode;
}

/** Значение для точки с наследованием от ближайшей более узкой точки. */
function valueAt(count: ColumnCount | undefined, point: Breakpoint): number | undefined {
    if (count === undefined || typeof count === 'number') return count;
    let value: number | undefined;
    for (const candidate of breakpoints) {
        value = count[candidate] ?? value;
        if (candidate === point) break;
    }
    return value;
}

/**
 * Размещение колонки на точке — значение `grid-column`. Без ширины колонка занимает всю строку
 * (`1 / -1`); это работает и во вложенной сетке, где линий меньше, чем у страницы.
 */
function placement(span: ColumnCount | undefined, offset: ColumnCount | undefined, point: Breakpoint): string {
    const columns = gridColumns[point];
    const width = valueAt(span, point);
    if (width === undefined || width >= columns) return '1 / -1';
    const shift = Math.min(Math.max(valueAt(offset, point) ?? 0, 0), columns - width);
    return shift > 0 ? `${shift + 1} / span ${width}` : `span ${Math.max(width, 1)}`;
}

/**
 * Область сетки. Колонка стоит прямо внутри `Grid`; её содержимое заполняет всю ширину области.
 * Внутрь колонки можно поставить `Grid subgrid`, чтобы разложить содержимое по тем же линиям.
 */
export function Column({ span, offset, hidden = false, children }: ColumnProperties) {
    const style = Object.fromEntries(breakpoints.map((point) => [columnVariable(point), placement(span, offset, point)])) as CSSProperties;
    return <div className={layoutClasses.column} style={hidden ? { ...style, display: 'none' } : style}>{children}</div>;
}
