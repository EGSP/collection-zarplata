import { Button, Flex, Form, Table, Typography, type TableProps } from 'antd';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentType, type Key, type ReactNode, type Ref, type RefObject } from 'react';
import type { FormTablePart } from '../../server/ui/descriptions';
import { FieldDisplay, FieldInput, hasInput } from '../widgets/registry';
import { fieldRules, isMarkedRequired } from '../widgets/validation';
import type { InputHandle, InputProperties } from '../widgets/widget';
import { RecordTablePart } from './record-table-part';
import { useFieldFocus } from './field-focus';
import { Icons } from './icons';
import { hasOpenDialog, hasOpenPicker } from './keyboard';
import { newRowValues } from './record-values';

/**
 * Настройки вида табличной части. Их задаёт собственная форма или элемент конфигурации, когда
 * стандартная таблица перегружена для своей задачи: например, у продажи узкие колонки кода
 * и стоимости, строка итогов и кнопка «Товар» вместо «Добавить строку». Форма передаёт
 * настройки части через `FieldGroup`, элемент на месте части передаёт их `TablePart` сам.
 */
export interface TablePartOptions {
    /**
     * Выводить ли название части над таблицей. Скрывается, когда подпись уже выводит контейнер
     * замены части или когда назначение таблицы понятно по форме.
     */
    readonly showTitle?: boolean | undefined;
    /**
     * Ширины колонок в пикселях по именам. С ними таблица раскладывается по заданным ширинам,
     * а колонки без ширины делят остаток поровну. Так ширины не меняются при вводе: в обычной
     * раскладке браузер подгоняет колонки под содержимое, и они сдвигаются с каждым символом.
     */
    readonly columnWidths?: { readonly [column: string]: number } | undefined;
    /**
     * Доли остатка ширины у колонок без заданной ширины. По умолчанию доля каждой равна 1,
     * то есть остаток делится поровну. Например, `{ name: 1, comment: 2 }` отдаёт названию треть
     * остатка, а комментарию две трети. Действует вместе с `columnWidths`.
     */
    readonly columnShares?: { readonly [column: string]: number } | undefined;
    /**
     * Поля ввода колонок по именам вместо виджета вида поля, например переключатель способа оплаты.
     * Поле получает те же свойства, что и виджет, и так же участвует в обходе с клавиатуры.
     */
    readonly columnInputs?: { readonly [column: string]: ComponentType<InputProperties<unknown>> } | undefined;
    /** Подпись кнопки добавления строки. По умолчанию «Добавить строку». */
    readonly addTitle?: string | undefined;
    /** Значок кнопки добавления строки. По умолчанию значок «+». */
    readonly addIcon?: ReactNode | undefined;
    /**
     * В таблице без строк сразу стоит одна пустая строка, чтобы ввод начинался без нажатия
     * кнопки. Строка добавляется один раз, когда таблица становится доступной для изменения,
     * и несохранённым изменением не считается: форма, которую не трогали, закрывается без вопроса.
     */
    readonly initialRow?: boolean | undefined;
    /**
     * Значения новой строки поверх значений по умолчанию колонок: незаданные колонки получают
     * значения по умолчанию. Вызывается при каждом добавлении, поэтому может предложить значение
     * от текущих строк, например остаток суммы.
     */
    readonly newRow?: (() => Record<string, unknown>) | undefined;
    /** Колонки, суммы которых выводятся последней строкой «Итого». */
    readonly totals?: ReadonlyArray<string> | undefined;
    /**
     * Порядок колонок на экране по именам. Названные колонки идут первыми в этом порядке, остальные
     * за ними в порядке описания. Порядок обхода с клавиатуры следует за порядком на экране.
     * Описание части не меняется, поэтому другие документы с теми же колонками его не замечают.
     */
    readonly columnOrder?: ReadonlyArray<string> | undefined;
    /**
     * Колонки, которые таблица не выводит. Значения скрытых колонок остаются в строках и
     * записываются вместе с ними; обязательной скрытой колонке значение задаёт `newRow`.
     * Так документ показывает только нужные ему колонки общей части: например, отвес не выводит
     * стоимость товара, которую заполняют уже в продаже. Описание части не меняется.
     */
    readonly hiddenColumns?: ReadonlyArray<string> | undefined;
    /**
     * Колонки, которые таблица показывает только для чтения, хотя по описанию части они изменяемы.
     * Например, состояние товара в записанном отвесе меняют кнопки формы, а не ввод в ячейке.
     */
    readonly readOnlyColumns?: ReadonlyArray<string> | undefined;
    /**
     * Строки нельзя добавлять и удалять: кнопки добавления и удаления строк не выводятся,
     * а значения в ячейках изменять можно. Так записанный документ сохраняет состав строк.
     */
    readonly fixedRows?: boolean | undefined;
}

/** Свойства табличной части. */
export interface TablePartProperties extends TablePartOptions {
    readonly part: FormTablePart;
    /** Строки нельзя изменять, добавлять и удалять: форма открыта только для просмотра. */
    readonly disabled?: boolean | undefined;
    /** Возвращает обход в предыдущее поле формы из первой ячейки. Без обработчика обход останавливается в первой ячейке. */
    readonly onPrevious?: (() => void) | undefined;
    /** Табличная часть входит в порядок обхода формы одной остановкой: фокус получает её первая ячейка. */
    readonly ref?: Ref<InputHandle> | undefined;
}

/** Строка табличной части, как её отдаёт список формы Ant Design: ключ строки и её номер в списке. */
interface Row {
    readonly key: number;
    readonly name: number;
}

/**
 * Табличная часть формы: таблица, в каждой ячейке которой стоит поле ввода из реестра виджетов.
 *
 * Компонент получает только описание табличной части и работает внутри формы Ant Design:
 * значение ячейки лежит в форме по пути «табличная часть, номер строки, поле». Сервер называет
 * поле с ошибкой таким же путём, поэтому его ошибки сопоставляются с ячейками напрямую.
 * Переходы между ячейками обрабатываются до виджета; открытый список выбора или календарь
 * получает Enter сам. При выходе назад из первой ячейки компонент возвращает управление форме.
 *
 * Строки записываются в том порядке, в котором стоят на форме: сервер при записи заменяет
 * строки целиком.
 */
export function TablePart(properties: TablePartProperties) {
    const part = shownPart(orderedPart(properties.part, properties.columnOrder), properties.hiddenColumns, properties.readOnlyColumns);
    // Значения новой строки собираются по всем колонкам, в том числе скрытым: их тоже записывает сервер.
    // Ими пользуются и кнопка добавления, и начальная строка.
    const newRow = () => ({ ...newRowValues(properties.part), ...properties.newRow?.() });
    return (
        <Form.List name={part.name}>
            {(rows, { add, remove }) => <RowTable {...properties} part={part} newRow={newRow} rows={rows} add={() => add(newRow())} remove={remove} />}
        </Form.List>
    );
}

/** Часть с колонками в порядке `columnOrder`. Без порядка возвращается та же часть. */
function orderedPart(part: FormTablePart, order: ReadonlyArray<string> | undefined): FormTablePart {
    if (order === undefined) return part;
    const position = (name: string) => {
        const index = order.indexOf(name);
        return index < 0 ? order.length : index;
    };
    // Сортировка устойчивая: колонки, не названные в порядке, сохраняют порядок описания.
    return { ...part, columns: [...part.columns].sort((left, right) => position(left.name) - position(right.name)) };
}

/**
 * Часть без колонок `hidden` и с колонками `readOnly`, отмеченными только для чтения.
 * Без таких колонок возвращается та же часть.
 */
function shownPart(part: FormTablePart, hidden: ReadonlyArray<string> | undefined, readOnly: ReadonlyArray<string> | undefined): FormTablePart {
    if ((hidden === undefined || hidden.length === 0) && (readOnly === undefined || readOnly.length === 0)) return part;
    return {
        ...part,
        columns: part.columns
            .filter((column) => hidden?.includes(column.name) !== true)
            .map((column) => (readOnly?.includes(column.name) === true ? { ...column, readOnly: true } : column)),
    };
}

/** Название табличной части над её строками. Одно на все таблицы, чтобы названия выглядели одинаково. */
export function TablePartTitle({ children }: { readonly children: ReactNode }) {
    return <Typography.Title level={5} style={{ margin: 0 }}>{children}</Typography.Title>;
}

interface RowTableProperties extends TablePartProperties {
    readonly rows: ReadonlyArray<Row>;
    readonly add: () => void;
    readonly remove: (index: number) => void;
}

/**
 * Фокус ячеек хранится по устойчивому ключу строки, поэтому удаление строки не сдвигает
 * ссылки на поля остальных строк. Новая строка получает фокус после регистрации её полей.
 */
function RowTable({ part, disabled = false, showTitle = true, ref, onPrevious, rows, add, remove, columnWidths, columnShares, columnInputs, addTitle = 'Добавить строку', addIcon = <Icons.add />, initialRow = false, newRow, totals = [], hiddenColumns = [], fixedRows = false }: RowTableProperties) {
    const form = Form.useFormInstance();
    const watched: unknown = Form.useWatch(part.name, { form, preserve: true });
    const values = (Array.isArray(watched) ? watched : form.getFieldValue(part.name) ?? []) as Record<string, unknown>[];
    const expanded = part.columns.filter((column) => column.expandedTablePart && column.target);
    const [expandedKeys, setExpandedKeys] = useState<ReadonlyArray<Key>>([]);
    const cells = useFieldFocus();
    const pendingRow = useRef<number | null>(null);
    const inputColumns = part.columns.filter((column) => !column.readOnly && hasInput(column));
    const cellName = (row: Row, column: string) => `${row.key}/${column}`;
    const focusCell = (rowIndex: number, columnIndex: number) => {
        const row = rows[rowIndex];
        const column = inputColumns[columnIndex];
        if (row !== undefined && column !== undefined) cells.focus(cellName(row, column.name));
    };
    const addRow = () => {
        if (disabled || fixedRows || inputColumns.length === 0 || pendingRow.current !== null) return;
        pendingRow.current = rows.length;
        add();
    };
    useLayoutEffect(() => {
        if (pendingRow.current === null || rows[pendingRow.current] === undefined) return;
        focusCell(pendingRow.current, 0);
        pendingRow.current = null;
    });
    // Начальная строка ставится значением формы, а не добавлением через список: добавление
    // считалось бы вводом пользователя, и нетронутая форма спросила бы при закрытии о потере изменений.
    const initialRowPlaced = useRef(false);
    useEffect(() => {
        if (!initialRow || initialRowPlaced.current || disabled) return;
        initialRowPlaced.current = true;
        if (rows.length === 0) form.setFieldValue(part.name, [newRow?.() ?? newRowValues(part)]);
    }, [disabled]);
    useImperativeHandle(ref, () => ({
        focus: () => {
            if (disabled) return;
            if (rows.length === 0) addRow();
            else focusCell(0, 0);
        },
    }));

    // Ширина нужна только для долей остатка: без них таблица за размером не следит.
    const container = useRef<HTMLDivElement>(null);
    const tableWidth = useElementWidth(container, columnWidths !== undefined && columnShares !== undefined);
    // Колонка удаления строки есть, только если строки можно удалять.
    const removable = !disabled && !fixedRows;
    const width = columnWidth(part, columnWidths, columnShares, removable, tableWidth);
    const columns: NonNullable<TableProps<Row>['columns']> = [
        {
            key: 'lineNumber', title: '№', width: serviceColumnWidth,
            // Скрытые колонки регистрируются невидимыми полями: форма отдаёт при записи только
            // зарегистрированные поля, и без них значения скрытых колонок не дошли бы до сервера.
            render: (_value, row, index) => <>{index + 1}{hiddenColumns.map((name) => <Form.Item key={name} name={[row.name, name]} hidden noStyle />)}</>,
        },
        ...part.columns.map((column) => {
            const columnWidth = width(column.name);
            return {
                key: column.name,
                ...(columnWidth === undefined ? {} : { width: columnWidth }),
                title: <>{column.title}{isMarkedRequired(column) && <Typography.Text type="danger"> *</Typography.Text>}</>,
                render: (_value: unknown, row: Row, rowIndex: number) => (
                    <div onKeyDownCapture={(event) => {
                        if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || disabled || hasOpenDialog(event.currentTarget) || hasOpenPicker(event.target)) return;
                        if (event.target instanceof HTMLElement && event.target.closest('button, a') !== null) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.repeat) return;
                        const columnIndex = inputColumns.findIndex((candidate) => candidate.name === column.name);
                        if (columnIndex < 0) return;
                        if (event.shiftKey) {
                            if (columnIndex > 0) focusCell(rowIndex, columnIndex - 1);
                            else if (rowIndex > 0) focusCell(rowIndex - 1, inputColumns.length - 1);
                            else onPrevious?.();
                        } else if (columnIndex < inputColumns.length - 1) focusCell(rowIndex, columnIndex + 1);
                        else if (rowIndex < rows.length - 1) focusCell(rowIndex + 1, 0);
                        else addRow();
                    }}>
                        <Form.Item name={[row.name, column.name]} rules={fieldRules(column)} style={{ margin: 0 }}>
                            {column.readOnly ? <FieldDisplay field={column} /> : <CellInput field={column} input={columnInputs?.[column.name]} ref={cells.register(cellName(row, column.name))} />}
                        </Form.Item>
                    </div>
                ),
            };
        }),
    ];
    if (removable) columns.push({
        key: 'remove', width: serviceColumnWidth,
        render: (_value, row) => <Button type="text" icon={<Icons.removeRow />} aria-label="Удалить строку" onClick={() => remove(row.name)} />,
    });
    return (
        <Flex ref={container} vertical gap="small" align="flex-start" data-table-part={part.name}>
            {showTitle && <TablePartTitle>{part.title}</TablePartTitle>}
            <Table<Row> size="small" style={{ width: '100%' }} rowKey="key" columns={columns} dataSource={[...rows]} pagination={false}
                {...(columnWidths === undefined ? {} : { tableLayout: 'fixed' as const })}
                {...(totals.length === 0 || rows.length === 0 ? {} : { summary: () => <TotalsRow part={part} values={values} totals={totals} removable={removable} /> })}
                expandable={expanded.length === 0 ? {} : {
                expandedRowKeys: [...expandedKeys],
                onExpandedRowsChange: setExpandedKeys,
                rowExpandable: (row) => expanded.some((column) => typeof values[row.name]?.[column.name] === 'string'),
                expandedRowRender: (row) => expandedKeys.includes(row.key) ? <Flex vertical gap="small">{expanded.filter((column) => typeof values[row.name]?.[column.name] === 'string').map((column) => <RecordTablePart key={column.name} object={column.target!} guid={String(values[row.name]?.[column.name])} part={column.expandedTablePart!} />)}</Flex> : null,
            }} locale={{ emptyText: 'Строк нет' }} />
            {!disabled && !fixedRows && <Button icon={addIcon} onClick={addRow}>{addTitle}</Button>}
        </Flex>
    );
}

/** Ширина служебных колонок: номера строки и кнопки удаления. */
const serviceColumnWidth = 48;

/**
 * Ширины колонок части по настройкам. Без `columnWidths` ширины не задаются, и таблица
 * раскладывается по содержимому. С ними колонка без ширины получает свою долю остатка: ширину
 * таблицы за вычетом заданных ширин и служебных колонок. Браузер не применяет к колонке ширину
 * через `calc` с процентами, поэтому доля считается в пикселях от измеренной ширины таблицы.
 * Пока ширина не измерена или долей нет, гибким колонкам ширина не задаётся, и браузер делит
 * остаток поровну.
 */
function columnWidth(
    part: FormTablePart,
    widths: TablePartOptions['columnWidths'],
    shares: TablePartOptions['columnShares'],
    removable: boolean,
    tableWidth: number,
): (column: string) => number | undefined {
    if (widths === undefined) return () => undefined;
    const flexible = part.columns.filter((column) => widths[column.name] === undefined).map((column) => column.name);
    if (shares === undefined || flexible.length === 0 || tableWidth === 0) return (column) => widths[column];
    const fixed = part.columns.reduce((sum, column) => sum + (widths[column.name] ?? 0), serviceColumnWidth * (removable ? 2 : 1));
    const share = (column: string) => shares[column] ?? 1;
    const total = flexible.reduce((sum, column) => sum + share(column), 0);
    const rest = Math.max(tableWidth - fixed, 0);
    return (column) => widths[column] ?? Math.floor(rest * share(column) / total);
}

/** Ширина элемента в пикселях; следит за её изменением. До первого измерения равна нулю. */
function useElementWidth(element: RefObject<HTMLElement | null>, enabled: boolean): number {
    const [width, setWidth] = useState(0);
    useLayoutEffect(() => {
        const target = element.current;
        if (!enabled || target === null) return;
        const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
        observer.observe(target);
        return () => observer.disconnect();
    }, [enabled]);
    return width;
}

/** Поле ввода ячейки: поле из настроек колонки либо виджет вида поля. Значение передаёт элемент формы Ant Design. */
function CellInput({ input: Input = FieldInput, ...properties }: InputProperties<unknown> & { readonly input?: ComponentType<InputProperties<unknown>> | undefined }) {
    return <Input {...properties} />;
}

interface TotalsRowProperties {
    readonly part: FormTablePart;
    readonly values: ReadonlyArray<Record<string, unknown>>;
    readonly totals: ReadonlyArray<string>;
    /** У таблицы есть колонка кнопок удаления: строка итогов оставляет под ней пустую ячейку. */
    readonly removable: boolean;
}

/**
 * Строка «Итого» под строками таблицы: суммы колонок из `totals` по текущим значениям формы,
 * поэтому итог меняется вместе с вводом. Подпись стоит в первой колонке без суммы.
 */
function TotalsRow({ part, values, totals, removable }: TotalsRowProperties) {
    const labelColumn = part.columns.find((column) => !totals.includes(column.name))?.name;
    return (
        <Table.Summary.Row>
            <Table.Summary.Cell index={0} />
            {part.columns.map((column, index) => (
                <Table.Summary.Cell key={column.name} index={index + 1}>
                    {totals.includes(column.name)
                        ? <Typography.Text strong><FieldDisplay field={column} value={values.reduce((sum, row) => sum + (typeof row[column.name] === 'number' ? row[column.name] as number : 0), 0)} /></Typography.Text>
                        : column.name === labelColumn ? <Typography.Text strong>Итого</Typography.Text> : null}
                </Table.Summary.Cell>
            ))}
            {removable && <Table.Summary.Cell index={part.columns.length + 1} />}
        </Table.Summary.Row>
    );
}
