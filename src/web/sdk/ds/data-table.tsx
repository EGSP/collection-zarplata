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
 * Схема отображения (`layouts`) объединяет колонки в составные по точке перелома ближайшего
 * `BreakpointContainer`: на узком месте код стоит над названием, а не в отдельной колонке.
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
 *     layouts={{ sm: [['code', 'name'], 'total'], lg: ['code', 'name', 'total'] }}
 * />
 * ```
 *
 * Высота строки — 40 px (размер `md` у Carbon), отступ ячейки — 16 px. Поля составной колонки
 * стоят по 32 px (размер `sm`), поэтому строка из двух полей — 64 px, как строка `xl` у Carbon,
 * предназначенная для двух строк значения. Заголовок той же высоты, что строки.
 *
 * Ячейка рисует рамку фокуса сама (`:focus-within`), поэтому содержимое при фокусе не сдвигается.
 * Содержимое ячейки отмечает своё состояние атрибутами: `data-cell-state="editing"` — ячейка
 * в режиме редактирования (фон поля), `data-cell-invalid` — значение не прошло проверку (красная
 * рамка). Поля ввода внутри ячейки не имеют своей рамки и отступа по горизонтали: их текст стоит
 * там же, где текст заголовка.
 * Элемент с атрибутом `data-cell-target` получает щелчок по отступу ячейки вокруг него.
 */
import { Checkbox, Radio, Spin, theme } from 'antd';
import { Fragment, useLayoutEffect, useRef, type CSSProperties, type Key, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { useBreakpoint } from './breakpoints';
import { Button } from './button';
import { cellAlign, cellColumnSize, cellInputClass, formatCell, type CellType } from './cell-types';
import { Icons } from './icons';
import { useLayer } from './layer';
import { spacing } from './layout';
import { columnGroups, columnTrack, groupSize, tableLayoutAt, type ColumnSize, type ControlColumnSize, type TableLayouts } from './table-layout';

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
    /** Схемы отображения по точкам перелома; без них колонки выводятся по одной. */
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
    const { frame, scroll, body, row, header, cell, expanded, empty, input } = classes;
    return [
        `.${frame} { position: relative; }`,
        `.${scroll} { overflow-x: auto; }`,
        // Тело не уже суммы минимумов колонок: остальное место браузер делит по долям.
        `.${body} { min-width: min-content; }`,
        // Строка — сетка из колонок и уровней. Поля составной колонки стоят на уровнях строки,
        // поэтому высота уровня общая для всех колонок, и подстроки соседних колонок стоят на одной
        // линии. Колонка из одного поля занимает все уровни.
        `.${row} { display: grid; grid-template-columns: var(--data-table-template); grid-template-rows: var(--data-table-levels); border-bottom: 1px solid var(--data-table-border); }`,
        `.${row}[data-summary] { grid-template-rows: minmax(var(--data-table-row-height), auto); }`,
        // Полужирный шрифт задаётся ячейкам, а не строке: минимумы колонок в `ch` считаются по шрифту
        // строки, и у полужирной строки заголовка колонки вышли бы шире, чем у строк данных.
        `.${header} { background: var(--data-table-header-background); }`,
        // Разделители. Строки таблицы разделены сплошной линией, поля составной колонки внутри
        // строки — пунктиром светлее: так видно, что поля под пунктиром относятся к той же строке.
        // У таблицы с составными колонками граница строк темнее, а строки чередуют фон (zebra
        // у Carbon): строка в две подстроки читается одним блоком даже при беглом взгляде.
        `.${frame}[data-stacked] .${row} { border-bottom-color: var(--data-table-row-border); }`,
        `.${row}[data-striped] { background: var(--data-table-stripe); }`,
        `.${header} .${cell}, .${row}[data-summary] .${cell} { font-weight: var(--data-table-header-weight); }`,
        `.${body} > .${row}:not(.${header})[data-clickable] { cursor: pointer; }`,
        `.${body} > .${row}:not(.${header}):not([data-state="locked"]):hover { background: var(--data-table-hover); }`,
        `.${row}[data-selected] { background: var(--data-table-selected); }`,
        `.${row}[data-state="muted"] { color: var(--data-table-muted); }`,
        `.${row}[data-state="locked"] { background: var(--data-table-locked-background); color: var(--data-table-locked-text); }`,
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
        `.${cell}:focus-within, .${cell}:focus-visible { outline: 2px solid var(--data-table-focus); outline-offset: -2px; }`,
        `.${cell}:has([data-cell-state="editing"]) { background: var(--data-table-editing-background); }`,
        // Собственное поле ячейки занимает её целиком: отступ ячейки переходит внутрь поля.
        `.${cell}:has(> [data-cell-editor="native"]) { padding-inline: 0; }`,
        `.${cell} > [data-cell-editor="native"] > .${input} { align-self: stretch; box-sizing: border-box; width: 100%; height: 100%; margin: 0; padding: 0 var(--data-table-cell-padding); border: 0; outline: none; background: transparent; color: inherit; font: inherit; text-align: inherit; }`,
        `.${cell} > [data-cell-editor="native"] > .${input} + * { margin-inline-end: var(--data-table-cell-padding); }`,
        `.${cell}:has([data-cell-invalid]) { outline: 2px solid var(--data-table-error); outline-offset: -2px; }`,
        // Содержимое ячейки с двумя режимами занимает её целиком: щелчок в любом месте ячейки
        // попадает в него, а рамку фокуса рисует сама ячейка.
        `.${cell} > [data-cell-target], .${cell} > [data-cell-state] { align-self: stretch; flex: 1; display: flex; align-items: center; gap: ${spacing[3]}px; min-width: 0; outline: none; }`,
        `.${cell} > [data-cell-target] { cursor: text; }`,
        `.${cell}[data-align="end"] > [data-cell-target] { justify-content: flex-end; }`,
        // Поле редактирования растягивается на ячейку. Элемент ячейки без режимов, например флажок
        // или переключатель, сохраняет свою ширину: растянутый переключатель сжимал подписи.
        `.${cell} > [data-cell-state="editing"] > * { flex: 1; min-width: 0; }`,
        // В собственном поле ячейки растягивается только само поле; кнопка рядом, например подбора, — своей ширины.
        `.${cell} > [data-cell-editor="native"] > :not(.${input}) { flex: none; }`,
        // Поле редактирования без рамки и внутреннего отступа: текст не сдвигается при входе в редактирование.
        // Отступ списка выбора Ant Design задаёт CSS-переменной на самом элементе, поэтому она переопределяется здесь.
        `.${cell} .ant-select { --ant-select-padding-horizontal: 0px; }`,
        `.${cell} .ant-input, .${cell} .ant-input-number, .${cell} .ant-input-number-input, .${cell} .ant-picker, .${cell} .ant-input-affix-wrapper { padding-inline: 0; }`,
        // Содержимое раскрытой строки не раздвигает таблицу: вложенная таблица прокручивается сама,
        // а не заставляет прокручиваться внешнюю вместе с её заголовком.
        `.${expanded} { padding: var(--data-table-cell-padding); border-bottom: 1px solid var(--data-table-border); contain: inline-size; }`,
        // Заголовок переносится только между словами: слово не разрывается, колонка не уже него.
        `.${header} .${cell} { overflow-wrap: normal; }`,
        `.${empty} { padding: var(--data-table-cell-padding); color: var(--data-table-muted); text-align: center; border-bottom: 1px solid var(--data-table-border); }`,
        // Тени у краёв прокрутки: видны, только если с этой стороны есть невидимое содержимое.
        `.${frame}::before, .${frame}::after { content: ""; position: absolute; top: 0; bottom: 0; width: ${spacing[5]}px; pointer-events: none; opacity: 0; transition: opacity 0.15s; z-index: 1; }`,
        `.${frame}::before { left: 0; background: linear-gradient(to right, var(--data-table-shadow), transparent); }`,
        `.${frame}::after { right: 0; background: linear-gradient(to left, var(--data-table-shadow), transparent); }`,
        `.${frame}[data-overflow-start]::before, .${frame}[data-overflow-end]::after { opacity: 1; }`,
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
    const { columns, rows, rowKey, layouts, selection, expansion, sort, onSort, summary, loading = false, emptyText = 'Строк нет', rowState, onRowClick, onRowDoubleClick, interactive = false } = properties;
    const { token } = theme.useToken();
    const layer = useLayer();
    const point = useBreakpoint();
    const frame = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    useOverflowShadows(frame, scroller);

    const byKey = new Map(columns.map((column) => [column.key, column]));
    const groups = columnGroups(columns.map((column) => column.key), tableLayoutAt(layouts, point))
        .map((keys) => keys.map((key) => byKey.get(key)!));
    // Уровни строки: столько, сколько полей в самой высокой составной колонке. Таблица с составными
    // колонками разделяет строки заметнее и чередует их фон.
    const levels = Math.max(1, ...groups.map((group) => group.length));
    const stacked = levels > 1;
    // Колонки служебных элементов стоят перед колонками данных: раскрытие строки, затем выбор.
    const serviceColumns = (expansion === undefined ? 0 : 1) + (selection === undefined ? 0 : 1);
    // Служебные колонки стоят перед колонками данных: раскрытие строки, затем выбор.
    const tracks = [
        ...(expansion === undefined ? [] : [columnTrack('control')]),
        ...(selection === undefined ? [] : [columnTrack('control')]),
        ...groups.map((group) => columnTrack(groupSize(group.map(columnSize)))),
    ];
    const variables = {
        '--data-table-template': tracks.join(' '),
        '--data-table-levels': stacked ? `repeat(${levels}, minmax(${stackedHeight}px, auto))` : `minmax(${rowHeight}px, auto)`,
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
        '--data-table-locked-background': token.colorFillTertiary,
        '--data-table-locked-text': token.colorTextTertiary,
        '--data-table-focus': token.colorPrimary,
        '--data-table-error': token.colorError,
        '--data-table-editing-background': token.colorBgContainer,
        '--data-table-shadow': token.colorFill,
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
     * Место ячейки в сетке строки: колонка группы и уровень поля. Колонка из одного поля занимает
     * все уровни; последнее поле составной колонки, в которой полей меньше уровней, — оставшиеся.
     */
    const placement = (groupIndex: number, level: number, groupLength: number) => ({
        style: {
            gridColumn: serviceColumns + groupIndex + 1,
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
        return (
            <div
                key={column.key}
                role="columnheader"
                {...cellProperties(column)}
                {...placement(groupIndex, level, groupLength)}
                {...(sorted === undefined ? {} : { 'aria-sort': sorted })}
                {...(sortable ? {
                    'data-sortable': true,
                    tabIndex: 0,
                    onClick: () => onSort(column.key),
                    onKeyDown: (event: KeyboardEvent) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        onSort(column.key);
                    },
                } : {})}
            >
                {column.title}
                {/* Значок несортированной колонки бледный: он только подсказывает, что сортировка возможна. */}
                {sortable && <SortIcon style={sorted === undefined ? { color: token.colorTextQuaternary, transform: 'rotate(90deg)' } : { color: token.colorPrimary }} />}
            </div>
        );
    };

    const header = (
        <div role="row" className={`${classes.row} ${classes.header}`}>
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
            {groups.flatMap((group, groupIndex) => group.map((column, level) => headerCell(column, groupIndex, level, group.length)))}
        </div>
    );

    const body = rows.map((row, index) => {
        const key = rowKey(row, index);
        const expandable = expansion?.isExpandable(row, index) === true;
        const expanded = expandable && expansion?.isExpanded(row, index) === true;
        const selected = selection?.isSelected(row, index) === true;
        const state = rowState?.(row, index);
        const disabled = selection?.isDisabled?.(row, index) === true;
        // Щелчок по элементу управления в строке не считается щелчком по строке: иначе выбор
        // флажком или нажатие кнопки ещё и открывали бы запись.
        const fromControl = (event: MouseEvent) => event.target instanceof Element && event.target.closest('button, a, input, label, [role="button"], [data-cell-target]') !== null;
        return (
            <Fragment key={key}>
                <div
                    role="row"
                    className={classes.row}
                    {...(stacked && index % 2 === 1 ? { 'data-striped': true } : {})}
                    {...(selected ? { 'data-selected': true, 'aria-selected': true } : {})}
                    {...(state === undefined ? {} : { 'data-state': state })}
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
                    {groups.flatMap((group, groupIndex) => group.map((column, level) => (
                        <div key={column.key} role={role} {...cellProperties(column)} {...placement(groupIndex, level, group.length)} onMouseDown={focusContent}>
                            {cellContent(column, row, index)}
                        </div>
                    )))}
                </div>
                {expanded && <div className={classes.expanded}>{expansion.render(row, index)}</div>}
            </Fragment>
        );
    });

    const totals = summary !== undefined && rows.length > 0 && (
        <div role="row" className={classes.row} data-summary>
            {expansion !== undefined && <div role={role} {...serviceCell} />}
            {selection !== undefined && <div role={role} {...serviceCell} />}
            {groups.map((group, groupIndex) => {
                // Строка итогов в один уровень: составная колонка выводит поле с итогом, а без итога —
                // первое поле, поэтому подпись «Итого» и сумма стоят на одной линии.
                const column = group.find((candidate) => summary[candidate.key] !== undefined) ?? group[0]!;
                return <div key={column.key} role={role} {...cellProperties(column)} {...placement(groupIndex, 0, 1)}>{summaryContent(column, summary[column.key])}</div>;
            })}
        </div>
    );

    return (
        <Spin spinning={loading}>
            <div ref={frame} className={classes.frame} style={variables} {...(stacked ? { 'data-stacked': true } : {})}>
                <div ref={scroller} className={classes.scroll}>
                    <div className={classes.body} role={interactive ? 'grid' : 'table'}>
                        {header}
                        {body}
                        {rows.length === 0 && <div className={classes.empty}>{emptyText}</div>}
                        {totals}
                    </div>
                </div>
            </div>
        </Spin>
    );
}

/** Содержимое ячейки итогов: значение примитивного типа форматируется, свободного — выводится как есть. */
function summaryContent<Row>(column: DataTableColumn<Row>, value: unknown): ReactNode {
    if (value === undefined || value === null) return null;
    // Подпись «Итого» стоит в колонке любого типа: строка выводится как есть.
    if (column.type === 'free' || typeof value === 'string') return value as ReactNode;
    return formatCell(column.type, value);
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

/**
 * Следит, есть ли невидимое содержимое слева и справа от области прокрутки, и отмечает это
 * атрибутами рамки: по ним CSS показывает тени у краёв. Пересчёт идёт при прокрутке и при смене
 * размеров области и её содержимого.
 */
function useOverflowShadows(frame: RefObject<HTMLDivElement | null>, scroller: RefObject<HTMLDivElement | null>) {
    useLayoutEffect(() => {
        const outer = frame.current;
        const area = scroller.current;
        if (outer === null || area === null) return;
        const update = () => {
            // Округление: при дробном масштабе страницы прокрутка до края даёт не ровно ноль.
            const start = area.scrollLeft > 1;
            const end = area.scrollLeft + area.clientWidth < area.scrollWidth - 1;
            outer.toggleAttribute('data-overflow-start', start);
            outer.toggleAttribute('data-overflow-end', end);
        };
        update();
        area.addEventListener('scroll', update, { passive: true });
        const observer = new ResizeObserver(update);
        observer.observe(area);
        if (area.firstElementChild !== null) observer.observe(area.firstElementChild);
        return () => {
            area.removeEventListener('scroll', update);
            observer.disconnect();
        };
    }, []);
}
