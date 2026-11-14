import { useOverflowShadows } from './overflow-shadows';
/**
 * Таблица данных дизайн-системы по образцу Data table из Carbon с цветами темы Ant Design.
 * Таблица Ant Design здесь не используется: её ячейка — рамка вокруг содержимого со своим
 * отступом, а поле ввода внутри добавляло второй отступ, и значение не стояло под заголовком.
 * Здесь отступ у ячейки один, и заголовок, значение, итог и поле редактирования начинаются
 * на одной вертикали.
 *
 * Колонки раскладывает CSS Grid по размерам из `table-layout.ts`: наименьшая ширина в знаках
 * и доля остатка. Заголовок и каждая строка — отдельные сетки с одним шаблоном колонок, поэтому
 * колонки совпадают без измерений. Минимумы не сжимаются: если места не хватает, таблица
 * прокручивается по горизонтали, а у края с невидимыми колонками появляется лёгкая тень.
 *
 * Компоновка (`layouts`) по точке перелома ближайшего `BreakpointContainer` задаёт схему колонок
 * и поведение при переполнении. Схема (`lines`) делит запись на строки (`line`) и ставит поля
 * группы (`group`) друг под другом в одной колонке: на узком месте код стоит над названием,
 * а суммы могут встать второй строкой под длинным названием. Поведение (`overflow`,
 * `list-overflow.ts`) выбирает, развернуть строки в странице или прокручивать их внутри таблицы,
 * и размер страницы. Его значения по умолчанию задаёт платформа, экран переопределяет нужные точки.
 *
 * ```tsx
 * <DataTable
 *     columns={[
 *         { key: 'code', title: 'Код', type: 'string', size: { minimum: 8 }, value: (row) => row.code },
 *         { key: 'name', title: 'Название', type: 'string', size: { minimum: 16, weight: 2 }, value: (row) => row.name },
 *         { key: 'total', title: 'Итог', type: 'money', value: (row) => row.total },
 *     ]}
 *     rows={lines}
 *     rowKey={(row) => row.lineNumber}
 *     layouts={{
 *         sm: { lines: [{ line: [{ group: ['code', 'name'] }, 'total'] }] },
 *         lg: { lines: [{ line: ['code', 'name', 'total'] }], overflow: { mode: 'scroll', rows: 10 } },
 *     }}
 * />
 * ```
 *
 * Высота строки — 40 px (размер `md` у Carbon), отступ ячейки — 16 px. Поля группы и строки
 * схемы стоят по 32 px (размер `sm`), поэтому запись из двух уровней — 64 px, как строка `xl`
 * у Carbon, предназначенная для двух строк значения. Заголовок раскладывается так же, как записи.
 *
 * Ячейка с двумя режимами рисует рамку фокуса сама, поэтому содержимое при фокусе не сдвигается.
 * Ячейка с элементом без режимов, например переключателем или кнопками способа оплаты, рамки
 * не рисует: фокус показывает сам элемент, и вторая рамка вокруг него только сбивала бы.
 * Содержимое ячейки отмечает своё состояние атрибутами: `data-cell-state="editing"` — ячейка
 * в режиме редактирования (фон поля), `data-cell-invalid` — значение не прошло проверку (красная
 * рамка). Поля ввода внутри ячейки не имеют своей рамки и отступа по горизонтали: их текст стоит
 * там же, где текст заголовка.
 * Элемент с атрибутом `data-cell-target` получает щелчок по отступу ячейки вокруг него.
 */
import { Checkbox, Pagination, Radio, Spin, theme } from 'antd';
import { Fragment, isValidElement, useLayoutEffect, useState, useRef, type CSSProperties, type HTMLAttributes, type Key, type MouseEvent, type ReactNode } from 'react';
import { mergeProps, usePress } from 'react-aria';
import { useBreakpoint } from './breakpoints';
import { Button } from './button';
import { cellAlign, cellColumnSize, cellInputClass, formatCell, type CellType } from './cell-types';
import { Icons } from './icons';
import { useLayer } from './layer';
import { isRendered } from './rendered';
import { spacing } from './layout';
import { listOverflowAt, useFillHeight, useListPages, type ListOverflow, type ListPagination } from './list-overflow';
import { columnLines, columnTrack, groupSize, interactiveTableLayoutDefaults, tableLayoutDefaults, tableLinesAt, tablePinningAt, trackMinimum, type ColumnSize, type ControlColumnSize, type TableLayouts } from './table-layout';

/**
 * Колонка таблицы со строками типа `Row`. Колонка сообщает тип своих значений (`cell-types.tsx`):
 * по нему таблица выравнивает и форматирует значения и выбирает размер колонки.
 *
 * Колонка примитивного типа отдаёт значение (`value`), а таблица выводит его текстом. Если ячейке
 * нужно больше текста, например поле ввода табличной части, колонка рисует её сама (`render`),
 * а выравнивание и цифры одной ширины всё равно берутся из типа. Колонка свободного типа `free`
 * всегда рисует ячейку сама.
 */
export interface DataTableColumn<Row> {
    /** Имя колонки: по нему колонку называют схема отображения, сортировка и строка итогов. */
    readonly key: string;
    readonly title: ReactNode;
    readonly type: CellType;
    /** Значение ячейки в формате сервера: сумма в копейках, дата строкой ISO. */
    readonly value?: ((row: Row, index: number) => unknown) | undefined;
    /** Собственное содержимое ячейки вместо значения. */
    readonly render?: ((row: Row, index: number) => ReactNode) | undefined;
    /**
     * Размер вместо размера типа: наименьшая ширина в знаках и доля остатка либо `control` —
     * квадрат служебного элемента, например кнопки удаления.
     */
    readonly size?: ColumnSize | ControlColumnSize | undefined;
    /** Щелчок по заголовку сортирует строки по колонке: о нём сообщает `onSort` таблицы. */
    readonly sortable?: boolean | undefined;
    /** Ячейка предлагает список (подсказки, варианты): колонка не уже `listCellMinimum` знаков. */
    readonly list?: boolean | undefined;
}

/** Размер колонки: служебный квадрат или размер по типу и заголовку. */
function columnSize<Row>(column: DataTableColumn<Row>): ColumnSize | ControlColumnSize {
    return column.size === 'control' ? 'control' : cellColumnSize(column.type, column.title, column.size, column.list === true);
}

/** Содержимое ячейки: собственное колонки либо текст значения по типу. */
function cellContent<Row>(column: DataTableColumn<Row>, row: Row, index: number): ReactNode {
    if (column.render !== undefined) return column.render(row, index);
    if (column.type === 'free' || column.value === undefined) return null;
    return formatCell(column.type, column.value(row, index));
}

/** Направление сортировки по колонке. */
export type DataTableSortDirection = 'ascending' | 'descending';

/**
 * Выбор строк флажками (`multiple`) или переключателем (`single`). Выбор хранит экран: таблица
 * показывает его и сообщает об изменении, поэтому строку можно сравнивать по ключу записи.
 */
export interface DataTableSelection<Row> {
    readonly mode: 'single' | 'multiple';
    readonly isSelected: (row: Row, index: number) => boolean;
    readonly onChange: (row: Row, index: number, selected: boolean) => void;
    /** Флажок в заголовке: отметить или снять все доступные строки. Только при `multiple`. */
    readonly onChangeAll?: ((selected: boolean) => void) | undefined;
    /** Строка, которую нельзя выбрать: флажок недоступен. */
    readonly isDisabled?: ((row: Row, index: number) => boolean) | undefined;
}

/** Раскрытие строки: содержимое под ней на всю ширину таблицы, например строки другой записи. */
export interface DataTableExpansion<Row> {
    /** Есть ли у строки содержимое. У строки без него нет кнопки раскрытия. */
    readonly isExpandable: (row: Row, index: number) => boolean;
    readonly isExpanded: (row: Row, index: number) => boolean;
    readonly onToggle: (row: Row, index: number, expanded: boolean) => void;
    /** Содержимое раскрытой строки. Вызывается только для раскрытых строк. */
    readonly render: (row: Row, index: number) => ReactNode;
}

/**
 * Вид строки: `muted` — бледный текст, например у записи с пометкой удаления; `locked` — строка
 * залита серым и недоступна для выбора, например уже возвращённый товар.
 */
export type DataTableRowState = 'muted' | 'locked';

/** Свойства таблицы данных. */
export interface DataTableProperties<Row> {
    readonly columns: ReadonlyArray<DataTableColumn<Row>>;
    readonly rows: ReadonlyArray<Row>;
    readonly rowKey: (row: Row, index: number) => Key;
    /**
     * Компоновка по точкам перелома: схема колонок (`lines`), поведение при переполнении
     * (`overflow`) и закрепление строк (`pinned`). Без схемы колонки выводятся по одной, без
     * `overflow` и `pinned` действуют значения платформы (`tableLayoutDefaults`, у таблицы с полями
     * ввода `interactiveTableLayoutDefaults`): на `sm` строки, в частности, не закрепляются.
     */
    readonly layouts?: TableLayouts | undefined;
    readonly selection?: DataTableSelection<Row> | undefined;
    readonly expansion?: DataTableExpansion<Row> | undefined;
    /** Текущая сортировка: значок у заголовка колонки и `aria-sort`. */
    readonly sort?: { readonly key: string; readonly direction: DataTableSortDirection } | null | undefined;
    /** Пользователь щёлкнул заголовок сортируемой колонки. */
    readonly onSort?: ((key: string) => void) | undefined;
    /**
     * Строка «Итого» под строками: значения по именам колонок. Значение колонки примитивного типа
     * таблица форматирует по типу, как значения строк: сумму итога передают копейками, подпись — строкой.
     * Колонке свободного типа передают готовое содержимое. Без свойства строки итогов нет.
     */
    readonly summary?: { readonly [key: string]: unknown } | undefined;
    /**
     * Страницы с сервера (`ListPagination`): таблица сообщает экрану номер и размер нужной
     * страницы, экран передаёт её строки в `rows`. Без свойства строки у клиента, и таблица делит
     * их на страницы сама по `pageSize` из компоновки. `'external'` означает, что страницы выводит
     * экран своим переключателем, как список записей с выбором размера страницы: таблица тогда
     * показывает `rows` целиком.
     */
    readonly pagination?: ListPagination | 'external' | undefined;
    /**
     * Отдельные записи, закреплённые у верхнего (`top`) или нижнего (`bottom`) края; остальные
     * функция отмечает `undefined`. Действует там, где компоновка включает `pinned.rows`.
     * К странице строки прилипают, только пока таблица помещается по ширине: таблица с прокруткой
     * вбок сама становится областью прокрутки, и браузер закрепляет строки в ней, а не на странице.
     */
    readonly pinnedRows?: ((row: Row, index: number) => 'top' | 'bottom' | undefined) | undefined;
    readonly loading?: boolean | undefined;
    /** Текст пустой таблицы, по умолчанию «Строк нет». */
    readonly emptyText?: ReactNode;
    readonly rowState?: ((row: Row, index: number) => DataTableRowState | undefined) | undefined;
    readonly onRowClick?: ((row: Row, index: number) => void) | undefined;
    readonly onRowDoubleClick?: ((row: Row, index: number) => void) | undefined;
    /**
     * Ячейки содержат элементы ввода: таблица объявляется сеткой (`role="grid"`), а не таблицей
     * для чтения. Так экранный диктор предлагает перемещаться по ячейкам.
     */
    readonly interactive?: boolean | undefined;
}

/** CSS-классы таблицы. Правила задаёт `dataTableStyleSheet`. */
const classes = {
    frame: 'data-table',
    scroll: 'data-table-scroll',
    body: 'data-table-body',
    row: 'data-table-row',
    header: 'data-table-header',
    cell: 'data-table-cell',
    lines: 'data-table-lines',
    line: 'data-table-line',
    expanded: 'data-table-expanded',
    empty: 'data-table-empty',
    // Поле ячейки ставится прямо в ячейку и само несёт её отступ: класс общий с `CellTextInput`.
    input: cellInputClass,
} as const;

/**
 * Правила таблицы. Цвета и размеры приходят CSS-переменными с корневого элемента: так правила
 * общие для всех таблиц, а тема Ant Design задаёт значения при отрисовке.
 */
function dataTableStyleSheet(): string {
    const { frame, scroll, body, row, lines, line, header, cell, expanded, empty, input } = classes;
    return [
        `.${frame} { position: relative; min-width: 0; max-width: 100%; }`,
        `.${scroll} { overflow-x: auto; }`,
        // Закрепление к странице: `clip` обрезает, но не создаёт области прокрутки, и прилипание
        // отсчитывается от страницы. Ставится, только пока таблица помещается по ширине.
        `.${scroll}[data-page-pinning] { overflow-x: clip; }`,
        // В режиме `scroll` таблица высотой в `rows` записей прокручивается сама по обеим осям.
        `.${scroll}[data-visible-rows] { overflow: auto; max-height: var(--data-table-visible-height); }`,
        // Закреплённые строки непрозрачны: прокручиваемые записи проходят под ними. Заголовок и итоги
        // лежат выше закреплённых записей, а итоги отделены от записей линией над ними.
        `.${row}[data-pinned] { position: sticky; z-index: 1; background-color: var(--data-table-pinned-background); }`,
        `.${header}[data-pinned], .${row}[data-summary][data-pinned] { z-index: 2; }`,
        `.${row}[data-summary][data-pinned] { box-shadow: 0 -1px 0 var(--data-table-row-border); }`,
        // Тело не уже суммы минимумов колонок: остальное место браузер делит по долям.
        `.${body} { min-width: min-content; }`,
        // Запись таблицы — сетка из служебных колонок (раскрытие, выбор) и области строк схемы.
        // Область не уже своего содержимого: при нехватке места таблица прокручивается, а не сжимает значения.
        `.${row} { display: grid; grid-template-columns: var(--data-table-template); border-bottom: 1px solid var(--data-table-border); }`,
        // Ширину области строк задают минимумы колонок, а не содержимое: `contain` не даёт длинному
        // значению без переноса (товары с многоточием) расширить колонку. Под минимумом таблица
        // прокручивается, остальное место колонки делят по долям.
        `.${lines} { display: flex; flex-direction: column; min-width: var(--data-table-lines-minimum); contain: inline-size; }`,
        // Строка схемы — своя сетка из колонок и уровней: колонки и уровни задаёт стиль строки. Поля
        // группы стоят на уровнях строки, поэтому подстроки соседних колонок стоят на одной линии.
        // Колонка из одного поля занимает все уровни. Строки схемы разделены пунктиром, как уровни.
        `.${line} { display: grid; }`,
        `.${line} + .${line} { border-top: 1px dashed var(--data-table-subrow-border); }`,
        // Полужирный шрифт задаётся ячейкам, а не строке: минимумы колонок в `ch` считаются по шрифту
        // строки, и у полужирной строки заголовка колонки вышли бы шире, чем у строк данных.
        // Заливки строк кладутся слоем поверх цвета фона: у закреплённой строки цвет фона непрозрачный,
        // и полупрозрачная заливка не открывает записи, проходящие под ней.
        `.${header} { background-image: linear-gradient(var(--data-table-header-background), var(--data-table-header-background)); }`,
        // Разделители. Строки таблицы разделены сплошной линией, поля составной колонки внутри
        // строки — пунктиром светлее: так видно, что поля под пунктиром относятся к той же строке.
        // У таблицы с составными колонками граница строк темнее, а строки чередуют фон (zebra
        // у Carbon): строка в две подстроки читается одним блоком даже при беглом взгляде.
        `.${frame}[data-stacked] .${row} { border-bottom-color: var(--data-table-row-border); }`,
        `.${row}[data-striped] { background-image: linear-gradient(var(--data-table-stripe), var(--data-table-stripe)); }`,
        `.${header} .${cell}, .${row}[data-summary] .${cell} { font-weight: var(--data-table-header-weight); }`,
        `.${body} > .${row}:not(.${header})[data-clickable] { cursor: pointer; }`,
        `.${body} > .${row}:not(.${header}):not([data-state="locked"]):hover { background-image: linear-gradient(var(--data-table-hover), var(--data-table-hover)); }`,
        `.${row}[data-selected] { background-image: linear-gradient(var(--data-table-selected), var(--data-table-selected)); }`,
        `.${row}[data-state="muted"] { color: var(--data-table-muted); }`,
        `.${row}[data-state="locked"] { background-image: linear-gradient(var(--data-table-locked-background), var(--data-table-locked-background)); color: var(--data-table-locked-text); }`,
        // Длинное значение переносится, а не обрезается: таблица показывает значение целиком.
        // Высоту ячейке задаёт уровень строки, поэтому своей наименьшей высоты у ячейки нет.
        `.${cell} { display: flex; align-items: center; gap: ${spacing[3]}px; min-width: 0; padding-inline: var(--data-table-cell-padding); overflow-wrap: anywhere; }`,
        // Пунктир над полем второго и следующих уровней: на одной высоте во всех колонках он читается
        // полосой подстроки, а сплошная граница строки остаётся границей между строками.
        `.${cell}[data-level] { border-top: 1px dashed var(--data-table-subrow-border); }`,
        `.${cell}[data-align="end"] { justify-content: flex-end; text-align: right; font-variant-numeric: tabular-nums; }`,
        `.${cell}[data-align="end"] input { text-align: right; }`,
        `.${cell}[data-align="center"] { justify-content: center; text-align: center; }`,
        // Числа и суммы набраны цифрами одной ширины: разряды стоят друг под другом.
        `.${cell}[data-type="number"], .${cell}[data-type="money"] { font-variant-numeric: tabular-nums; }`,
        `.${cell}[data-control] { justify-content: center; padding: 0; }`,
        `.${cell}[data-sortable] { cursor: pointer; user-select: none; }`,
        // Рамка фокуса только у значения ячейки с двумя режимами и у поля, в котором оно редактируется.
        `.${cell}:focus-visible, .${cell}:has(> [data-cell-target]:focus), .${cell}:has(> [data-cell-state="editing"]):focus-within { outline: 2px solid var(--data-table-focus); outline-offset: -2px; }`,
        `.${cell}:has([data-cell-state="editing"]) { background: var(--data-table-editing-background); }`,
        // Собственное поле ячейки занимает её целиком: отступ ячейки переходит внутрь поля.
        `.${cell}:has(> [data-cell-editor="native"]) { padding-inline: 0; }`,
        `.${cell} > [data-cell-editor="native"] > .${input} { align-self: stretch; box-sizing: border-box; width: 100%; height: 100%; margin: 0; padding: 0 var(--data-table-cell-padding); border: 0; outline: none; background: transparent; color: inherit; font: inherit; text-align: inherit; }`,
        // Справа от поля стоят кнопка подбора или календаря и значок ошибки. Отступ ячейки получает
        // последний из них: иначе значок ошибки после кнопки прижимался бы к краю ячейки.
        `.${cell} > [data-cell-editor="native"] > :last-child:not(.${input}) { margin-inline-end: var(--data-table-cell-padding); }`,
        `.${cell}:has([data-cell-invalid]) { outline: 2px solid var(--data-table-error); outline-offset: -2px; }`,
        // Содержимое ячейки с двумя режимами занимает её целиком: щелчок в любом месте ячейки
        // попадает в него, а рамку фокуса рисует сама ячейка.
        // Содержимое ячейки не шире самой ячейки: значение с многоточием сжимается вместе с колонкой.
        `.${cell} > * { min-width: 0; }`,
        `.${cell} > [data-cell-target], .${cell} > [data-cell-state] { align-self: stretch; flex: 1; display: flex; align-items: center; gap: ${spacing[3]}px; min-width: 0; outline: none; }`,
        `.${cell} > [data-cell-target] { cursor: text; }`,
        `.${cell}[data-align="end"] > [data-cell-target] { justify-content: flex-end; }`,
        // Поле редактирования растягивается на ячейку. Элемент ячейки без режимов, например флажок
        // или переключатель, сохраняет свою ширину: растянутый переключатель сжимал подписи.
        `.${cell} > [data-cell-state="editing"] > * { flex: 1; min-width: 0; }`,
        // В собственном поле ячейки растягивается только само поле; кнопка рядом, например подбора, — своей ширины.
        `.${cell} > [data-cell-editor="native"] > :not(.${input}) { flex: none; }`,
        // Нативная подсказка совпадает с фоновым названием в просмотре и не меняет высоту строки.
        `.${cell} .${input}::placeholder { color: var(--data-table-placeholder); font-weight: var(--data-table-header-weight); opacity: 1; }`,
        `.${cell} .${input}:placeholder-shown { text-overflow: ellipsis; }`,
        // Поле редактирования без рамки и внутреннего отступа: текст не сдвигается при входе в редактирование.
        // Отступ списка выбора Ant Design задаёт CSS-переменной на самом элементе, поэтому она переопределяется здесь.
        `.${cell} .ant-select { --ant-select-padding-horizontal: 0px; }`,
        `.${cell} .ant-input, .${cell} .ant-input-number, .${cell} .ant-input-number-input, .${cell} .ant-picker, .${cell} .ant-input-affix-wrapper { padding-inline: 0; }`,
        // Содержимое раскрытой строки не раздвигает таблицу: вложенная таблица прокручивается сама,
        // а не заставляет прокручиваться внешнюю вместе с её заголовком. Отступ слева равен ширине
        // служебных колонок и отступу ячейки: содержимое начинается на линии первой колонки данных,
        // и экрану не нужно его вычислять. Запись и её раскрытие разделены пунктиром как одна
        // запись, а под раскрытием стоит граница записей, чтобы оно не сливалось со следующей.
        `.${row}[data-expanded] { border-bottom-style: dashed; border-bottom-color: var(--data-table-subrow-border); }`,
        `.${expanded} { padding-block: var(--data-table-cell-padding); padding-inline: calc(var(--data-table-service-width) + var(--data-table-cell-padding)) var(--data-table-cell-padding); border-bottom: 1px solid var(--data-table-row-border); contain: inline-size; }`,
        // Заголовок переносится только между словами: слово не разрывается, колонка не уже него.
        `.${header} .${cell} { overflow-wrap: normal; }`,
        `.${empty} { padding: var(--data-table-cell-padding); color: var(--data-table-muted); text-align: center; border-bottom: 1px solid var(--data-table-border); }`,
    ].join('\n');
}

// Таблица стилей добавляется при первом импорте модуля, один раз на документ.
if (typeof document !== 'undefined' && document.getElementById('data-table-styles') === null) {
    const element = document.createElement('style');
    element.id = 'data-table-styles';
    element.textContent = dataTableStyleSheet();
    document.head.append(element);
}

/** Высота строки, поля составной колонки и отступ ячейки по шкале Carbon: размеры `md` и `sm`. */
const rowHeight = spacing[8];
const stackedHeight = spacing[7];
const cellPadding = spacing[5];

/** Таблица данных. Правила и пример описаны во вводном комментарии модуля. */
export function DataTable<Row>(properties: DataTableProperties<Row>) {
    const { columns, rows: sourceRows, rowKey, pagination, pinnedRows, layouts, selection, expansion, sort, onSort, summary, loading = false, emptyText = 'Строк нет', rowState, onRowClick, onRowDoubleClick, interactive = false } = properties;
    const point = useBreakpoint();
    // Поведение при переполнении: переопределение экрана или значение платформы для текущей точки.
    // Поведение и закрепление выбираются по одной компоновке: запись экрана выше значений платформы.
    const layoutDefaults = interactive ? interactiveTableLayoutDefaults : tableLayoutDefaults;
    const overflow: ListOverflow = listOverflowAt(layouts, point, layoutDefaults);
    const pinning = tablePinningAt(layouts, point, layoutDefaults);
    const pinned = {
        header: pinning.header === true,
        summary: pinning.summary === true,
        rows: pinning.rows === true ? pinnedRows : undefined,
    };
    // При `'external'` страницы выводит экран, и размер страницы из компоновки таблица не применяет.
    const external = pagination === 'external';
    const pages = useListPages(sourceRows, external ? { ...overflow, pageSize: undefined } : overflow, external ? undefined : pagination);
    const rows = pages.rows;
    const visibleRows = overflow.mode === 'scroll' ? overflow.rows : undefined;
    const { token } = theme.useToken();
    const layer = useLayer();
    const frame = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const headerRow = useRef<HTMLDivElement>(null);
    const summaryRow = useRef<HTMLDivElement>(null);
    useOverflowShadows(frame, scroller);
    // Закрепление к странице действует, пока таблица помещается по ширине (`pinned` компоновки).
    const pagePinning = (pinned.header || pinned.summary || pinned.rows !== undefined) && overflow.mode === 'expand';
    const [fitsWidth, setFitsWidth] = useState(true);
    useLayoutEffect(() => {
        const area = scroller.current;
        const content = area?.firstElementChild;
        if (!pagePinning || area === null || content === null || content === undefined) return;
        // Ширина тела не меньше суммы минимумов колонок и не зависит от `overflow`, поэтому
        // переключение между `clip` и прокруткой не меняет результат сравнения.
        const update = () => { if (isRendered(area)) setFitsWidth(content.getBoundingClientRect().width <= area.clientWidth + 1); };
        const observer = new ResizeObserver(update);
        observer.observe(area);
        observer.observe(content);
        update();
        return () => observer.disconnect();
    }, [pagePinning]);
    // Высоты заголовка и итогов измеряются: заголовок может переноситься, а от этих высот
    // отсчитываются закреплённые записи и высота таблицы в режиме `scroll`.
    useLayoutEffect(() => {
        const outer = frame.current;
        if (outer === null) return;
        const update = () => {
            if (!isRendered(outer)) return;
            outer.style.setProperty('--data-table-header-height', `${headerRow.current?.offsetHeight ?? 0}px`);
            outer.style.setProperty('--data-table-summary-height', `${summaryRow.current?.offsetHeight ?? 0}px`);
        };
        const observer = new ResizeObserver(update);
        if (headerRow.current !== null) observer.observe(headerRow.current);
        if (summaryRow.current !== null) observer.observe(summaryRow.current);
        update();
        return () => observer.disconnect();
    });

    const filled = useFillHeight(scroller, frame, overflow.mode === 'scroll' && overflow.fill === true, rows);

    const byKey = new Map(columns.map((column) => [column.key, column]));
    // Строки схемы: в строке колонки, в колонке поля группы сверху вниз.
    const lines = columnLines(columns.map((column) => column.key), tableLinesAt(layouts, point))
        .map((line) => line.map((group) => group.map((key) => byKey.get(key)!)));
    // Уровни строки схемы: столько, сколько полей в самой высокой её группе. Таблица с группами или
    // несколькими строками схемы разделяет записи заметнее и чередует их фон.
    const levelsOf = (line: ReadonlyArray<ReadonlyArray<DataTableColumn<Row>>>) => Math.max(1, ...line.map((group) => group.length));
    const stacked = lines.length > 1 || lines.some((line) => levelsOf(line) > 1);
    // Колонки служебных элементов стоят перед колонками данных: раскрытие строки, затем выбор.
    const serviceColumns = (expansion === undefined ? 0 : 1) + (selection === undefined ? 0 : 1);
    const tracks = [...Array.from({ length: serviceColumns }, () => columnTrack('control')), 'minmax(var(--data-table-lines-minimum), 1fr)'];
    // Наименьшая ширина области строк: самая широкая из строк схемы по сумме минимумов её колонок.
    const linesMinimum = `max(${lines.map((line) => line.length === 0 ? '0px' : `calc(${line.map((group) => trackMinimum(groupSize(group.map(columnSize)))).join(' + ')})`).join(', ')})`;
    /**
     * Сетка строки схемы: колонки по размерам полей и уровни. Строка итогов выводит каждую строку
     * схемы в один уровень: высотой обычной строки, а при нескольких строках схемы — подстроки.
     */
    const lineStyle = (line: ReadonlyArray<ReadonlyArray<DataTableColumn<Row>>>, summaryRow: boolean): CSSProperties => ({
        gridTemplateColumns: line.map((group) => columnTrack(groupSize(group.map(columnSize)))).join(' '),
        gridTemplateRows: summaryRow
            ? `minmax(${lines.length > 1 ? stackedHeight : rowHeight}px, auto)`
            : stacked ? `repeat(${levelsOf(line)}, minmax(${stackedHeight}px, auto))` : `minmax(${rowHeight}px, auto)`,
    });
    /** Область строк схемы у записи, заголовка или итогов: `cells` выводит ячейки одной строки схемы. */
    const linesOf = (cells: (line: ReadonlyArray<ReadonlyArray<DataTableColumn<Row>>>) => ReactNode, summaryRow = false) => (
        <div className={classes.lines}>
            {lines.map((line, lineIndex) => <div key={lineIndex} className={classes.line} style={lineStyle(line, summaryRow)}>{cells(line)}</div>)}
        </div>
    );
    // Расчётная высота записи без раскрытия: уровни всех строк схемы и граница под записью.
    const recordHeight = (stacked ? lines.reduce((sum, line) => sum + levelsOf(line) * stackedHeight, 0) : rowHeight) + 1;
    // Высота в `rows` записей; при `fill` таблица доходит до нижнего края экрана, но не ниже неё.
    const rowsHeight = visibleRows === undefined ? undefined : `calc(var(--data-table-header-height, ${recordHeight}px) + ${visibleRows * recordHeight}px + var(--data-table-summary-height, 0px))`;
    const variables = {
        ...(rowsHeight === undefined ? {} : { '--data-table-visible-height': filled === null ? rowsHeight : `max(${rowsHeight}, ${filled}px)` }),
        '--data-table-pinned-background': layer.background,
        '--data-table-template': tracks.join(' '),
        '--data-table-lines-minimum': linesMinimum,
        '--data-table-service-width': `${serviceColumns * rowHeight}px`,
        '--data-table-row-height': `${rowHeight}px`,
        '--data-table-stacked-height': `${stackedHeight}px`,
        '--data-table-cell-padding': `${cellPadding}px`,
        '--data-table-border': token.colorBorderSecondary,
        '--data-table-row-border': token.colorTextQuaternary,
        '--data-table-subrow-border': token.colorBorder,
        '--data-table-stripe': token.colorFillQuaternary,
        '--data-table-header-background': layer.backgroundStrong,
        '--data-table-header-weight': String(token.fontWeightStrong),
        '--data-table-hover': token.controlItemBgHover,
        '--data-table-selected': token.controlItemBgActive,
        '--data-table-muted': token.colorTextDisabled,
        '--data-table-placeholder': token.colorTextPlaceholder,
        '--data-table-locked-background': token.colorFillTertiary,
        '--data-table-locked-text': token.colorTextTertiary,
        '--data-table-focus': token.colorPrimary,
        '--data-table-error': token.colorError,
        '--data-table-editing-background': token.colorBgContainer,
    } as CSSProperties;

    const role = interactive ? 'gridcell' : 'cell';
    const cellProperties = (column: DataTableColumn<Row>) => {
        const align = cellAlign(column.type);
        return {
            className: classes.cell,
            'data-type': column.type,
            ...(align === 'start' ? {} : { 'data-align': align }),
            ...(column.size === 'control' ? { 'data-control': true } : {}),
        };
    };
    /**
     * Место ячейки в сетке строки схемы: колонка группы и уровень поля. Колонка из одного поля
     * занимает все уровни; последнее поле группы, в которой полей меньше уровней, — оставшиеся.
     */
    const placement = (groupIndex: number, level: number, groupLength: number) => ({
        style: {
            gridColumn: groupIndex + 1,
            gridRow: groupLength === 1 ? '1 / -1' : level === groupLength - 1 ? `${level + 1} / -1` : level + 1,
        },
        ...(groupLength > 1 && level > 0 ? { 'data-level': level } : {}),
    });
    /** Служебная ячейка занимает все уровни строки. */
    const serviceCell = { className: classes.cell, 'data-control': true, style: { gridRow: '1 / -1' } };

    const selectable = selection === undefined ? [] : rows.map((row, index) => ({ row, index })).filter(({ row, index }) => selection.isDisabled?.(row, index) !== true);
    const selectedCount = selection === undefined ? 0 : selectable.filter(({ row, index }) => selection.isSelected(row, index)).length;

    const headerCell = (column: DataTableColumn<Row>, groupIndex: number, level: number, groupLength: number) => {
        const sorted = sort?.key === column.key ? sort.direction : undefined;
        const sortable = column.sortable === true && onSort !== undefined;
        const SortIcon = sorted === 'ascending' ? Icons.sortAscending : sorted === 'descending' ? Icons.sortDescending : Icons.sortable;
        const attributes = {
            role: 'columnheader',
            ...cellProperties(column),
            ...placement(groupIndex, level, groupLength),
            ...(sorted === undefined ? {} : { 'aria-sort': sorted }),
        };
        if (!sortable) return <div key={column.key} {...attributes}>{column.title}</div>;
        return (
            <SortableHeaderCell key={column.key} attributes={attributes} onSort={() => onSort(column.key)}>
                {column.title}
                {/* Значок несортированной колонки бледный: он только подсказывает, что сортировка возможна. */}
                <SortIcon style={sorted === undefined ? { color: token.colorTextQuaternary, transform: 'rotate(90deg)' } : { color: token.colorPrimary }} />
            </SortableHeaderCell>
        );
    };

    const header = (
        <div ref={headerRow} role="row" className={`${classes.row} ${classes.header}`} {...(pinned.header ? { 'data-pinned': true, style: { top: 0 } } : {})}>
            {expansion !== undefined && <div role="columnheader" {...serviceCell} aria-label="Раскрытие строки" />}
            {selection !== undefined && (
                <div role="columnheader" {...serviceCell}>
                    {selection.mode === 'multiple' && selection.onChangeAll !== undefined && (
                        <Checkbox
                            aria-label="Выбрать все строки"
                            disabled={selectable.length === 0}
                            checked={selectable.length > 0 && selectedCount === selectable.length}
                            indeterminate={selectedCount > 0 && selectedCount < selectable.length}
                            onChange={(event) => selection.onChangeAll?.(event.target.checked)}
                        />
                    )}
                </div>
            )}
            {linesOf((line) => line.flatMap((group, groupIndex) => group.map((column, level) => headerCell(column, groupIndex, level, group.length))))}
        </div>
    );

    // Место закреплённой записи: под заголовком (над итогами) и под закреплёнными перед ней (после
    // неё) записями того же края. Отступы считаются по расчётной высоте записи.
    const edges = rows.map((row, index) => pinned.rows?.(row, index));
    const pinStyle = (index: number): CSSProperties | undefined => {
        if (edges[index] === 'top') {
            const before = edges.slice(0, index).filter((edge) => edge === 'top').length;
            return { top: `calc(${pinned.header ? 'var(--data-table-header-height)' : '0px'} + ${before * recordHeight}px)` };
        }
        if (edges[index] === 'bottom') {
            const after = edges.slice(index + 1).filter((edge) => edge === 'bottom').length;
            return { bottom: `calc(${pinned.summary && summary !== undefined ? 'var(--data-table-summary-height)' : '0px'} + ${after * recordHeight}px)` };
        }
        return undefined;
    };
    const body = rows.map((row, index) => {
        const key = rowKey(row, index);
        const expandable = expansion?.isExpandable(row, index) === true;
        const expanded = expandable && expansion?.isExpanded(row, index) === true;
        const selected = selection?.isSelected(row, index) === true;
        const state = rowState?.(row, index);
        const disabled = selection?.isDisabled?.(row, index) === true;
        const pinStyleOfRow = pinStyle(index);
        // Щелчок по элементу управления в строке не считается щелчком по строке: иначе выбор
        // флажком или нажатие кнопки ещё и открывали бы запись.
        const fromControl = (event: MouseEvent) => event.target instanceof Element && event.target.closest('button, a, input, label, [role="button"], [data-cell-target]') !== null;
        return (
            <Fragment key={key}>
                <div
                    role="row"
                    className={classes.row}
                    {...(stacked && index % 2 === 1 ? { 'data-striped': true } : {})}
                    {...(expanded ? { 'data-expanded': true } : {})}
                    {...(selected ? { 'data-selected': true, 'aria-selected': true } : {})}
                    {...(state === undefined ? {} : { 'data-state': state })}
                    {...(pinStyleOfRow === undefined ? {} : { 'data-pinned': true, style: pinStyleOfRow })}
                    {...(onRowClick === undefined ? {} : { 'data-clickable': true, onClick: (event: MouseEvent) => { if (!fromControl(event)) onRowClick(row, index); } })}
                    {...(onRowDoubleClick === undefined ? {} : { onDoubleClick: (event: MouseEvent) => { if (!fromControl(event)) onRowDoubleClick(row, index); } })}
                >
                    {expansion !== undefined && (
                        <div role={role} {...serviceCell}>
                            {expandable && (
                                <Button
                                    type="text"
                                    icon={expanded ? <Icons.collapse /> : <Icons.expand />}
                                    aria-label={expanded ? 'Свернуть строку' : 'Раскрыть строку'}
                                    onClick={() => expansion.onToggle(row, index, !expanded)}
                                />
                            )}
                        </div>
                    )}
                    {selection !== undefined && (
                        <div role={role} {...serviceCell}>
                            {selection.mode === 'multiple'
                                ? <Checkbox aria-label="Выбрать строку" checked={selected} disabled={disabled} onChange={(event) => selection.onChange(row, index, event.target.checked)} />
                                : <Radio aria-label="Выбрать строку" checked={selected} disabled={disabled} onChange={() => selection.onChange(row, index, true)} />}
                        </div>
                    )}
                    {linesOf((line) => line.flatMap((group, groupIndex) => group.map((column, level) => (
                        <div key={column.key} role={role} {...cellProperties(column)} {...placement(groupIndex, level, group.length)} onMouseDown={focusContent}>
                            {cellContent(column, row, index)}
                        </div>
                    ))))}
                </div>
                {expanded && <div className={classes.expanded}>{expansion.render(row, index)}</div>}
            </Fragment>
        );
    });

    const totals = summary !== undefined && rows.length > 0 && (
        <div ref={summaryRow} role="row" className={classes.row} data-summary {...(pinned.summary ? { 'data-pinned': true, style: { bottom: 0 } } : {})}>
            {expansion !== undefined && <div role={role} {...serviceCell} />}
            {selection !== undefined && <div role={role} {...serviceCell} />}
            {linesOf((line) => line.map((group, groupIndex) => {
                // Строка итогов в один уровень: группа выводит поле с итогом, а без итога — первое
                // поле, поэтому подпись «Итого» и сумма стоят на одной линии.
                const column = group.find((candidate) => summary[candidate.key] !== undefined) ?? group[0]!;
                return <div key={column.key} role={role} {...cellProperties(column)} {...placement(groupIndex, 0, 1)}>{summaryContent(column, summary[column.key])}</div>;
            }), true)}
        </div>
    );

    return (
        <Spin spinning={loading}>
            <div ref={frame} className={classes.frame} style={variables} {...(stacked ? { 'data-stacked': true } : {})}>
                <div
                    ref={scroller}
                    className={classes.scroll}
                    {...(visibleRows === undefined ? {} : { 'data-visible-rows': true })}
                    {...(pagePinning && fitsWidth ? { 'data-page-pinning': true } : {})}
                >
                    <div className={classes.body} role={interactive ? 'grid' : 'table'}>
                        {header}
                        {body}
                        {rows.length === 0 && <div className={classes.empty}>{emptyText}</div>}
                        {totals}
                    </div>
                </div>
            </div>
            {/* Переключатель не выводится, пока все строки помещаются на одну страницу. */}
            {pages.control !== undefined && <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBlock: spacing[3] }}><Pagination size="small" {...pages.control} showSizeChanger={false} /></div>}
        </Spin>
    );
}

/** Содержимое ячейки итогов: значение примитивного типа форматируется, свободного — выводится как есть. */
function summaryContent<Row>(column: DataTableColumn<Row>, value: unknown): ReactNode {
    if (value === undefined || value === null) return null;
    // Подпись «Итого» стоит в колонке любого типа: строка выводится как есть.
    if (isValidElement(value) || column.type === 'free' || typeof value === 'string') return value as ReactNode;
    return formatCell(column.type, value);
}

/**
 * Заголовок сортируемой колонки. Отдельный компонент, потому что хук нажатия нужен каждому
 * заголовку, а заголовки строятся в цикле. `usePress` меняет сортировку щелчком, касанием, Enter
 * и пробелом одинаково.
 */
function SortableHeaderCell({ attributes, onSort, children }: {
    /** Роль, класс, место в сетке и `aria-sort`, общие с несортируемым заголовком. */
    readonly attributes: HTMLAttributes<HTMLDivElement>;
    readonly onSort: () => void;
    readonly children: ReactNode;
}) {
    const { pressProps } = usePress({ onPress: onSort });
    return <div {...mergeProps(attributes, pressProps)} data-sortable tabIndex={0}>{children}</div>;
}

/**
 * Щелчок по отступу ячейки передаётся её содержимому с атрибутом `data-cell-target`: ячейка
 * с двумя режимами начинает редактирование, даже если пользователь попал не в текст, а рядом.
 * Ссылки и кнопки этот атрибут не ставят, поэтому щелчок мимо них ничего не открывает.
 */
function focusContent(event: MouseEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    const content = event.currentTarget.querySelector<HTMLElement>('[data-cell-target]');
    if (content === null) return;
    event.preventDefault();
    content.click();
}
