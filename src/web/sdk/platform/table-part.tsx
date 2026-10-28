import { Form, Typography } from 'antd';
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentType, type Key, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import type { FormField, FormTablePart } from '../../../server/ui/descriptions';
import { FieldDisplay, hasInput } from '../../widgets/registry';
import { fieldRules, isMarkedRequired } from '../../widgets/validation';
import type { InputHandle, InputProperties } from '../../widgets/widget';
import { RecordTablePart } from './record-table-part';
import { useFieldFocus } from './field-focus';
import { fieldColumnSize } from './column-sizes';
import { TableCell } from './table-cell';
import { useBreakpoint } from '../ds/breakpoints';
import { Button } from '../ds/button';
import { DataTable, type DataTableColumn, type DataTableExpansion } from '../ds/data-table';
import { Icons } from '../ds/icons';
import { Stack } from '../ds/stack';
import { columnGroups, tableLayoutAt, type ColumnSize, type TableLayouts } from '../ds/table-layout';
import { hasOpenDialog, hasOpenPicker } from './keyboard';
import { newRowValues } from './record-values';

/**
 * Настройки вида табличной части. Их задаёт собственная форма или элемент конфигурации, когда
 * стандартная таблица перегружена для своей задачи: например, у продажи узкая колонка кода,
 * код над названием на узком экране, строка итогов и кнопка «Товар» вместо «Добавить строку». Форма передаёт
 * настройки части через `FieldGroup`, элемент на месте части передаёт их `TablePart` сам.
 */
export interface TablePartOptions {
    /**
     * Выводить ли название части над таблицей. Скрывается, когда подпись уже выводит контейнер
     * замены части или когда назначение таблицы понятно по форме.
     */
    readonly showTitle?: boolean | undefined;
    /**
     * Размеры колонок по именам вместо размера по виду поля: наименьшая ширина в знаках и доля
     * остатка. Например, `{ code: { minimum: 8 }, comment: { minimum: 16, weight: 3 } }`: код не растёт,
     * а комментарий получает три доли остатка. Пикселей настройка не принимает: колонки следуют
     * за шрифтом и делят место таблицы сами.
     */
    readonly columnSizes?: { readonly [column: string]: ColumnSize } | undefined;
    /**
     * Схемы отображения по точкам перелома: какие колонки объединить в составные. Схема действует
     * от своей точки и шире; уже самой узкой названной точки колонки выводятся по одной, и таблица
     * прокручивается. Порядок колонок в схеме задаёт и порядок обхода с клавиатуры.
     */
    readonly layouts?: TableLayouts | undefined;
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
    /**
     * Содержимое под строкой: например, товары продажи из строки основания возврата. Строка
     * получает кнопку раскрытия и изначально раскрыта; пользователь может её свернуть. Вместо
     * содержимого можно вернуть `null`: такая строка не раскрывается. Заменяет раскрытие
     * по ссылке (`expandTablePart`), если оно есть у колонки. Функция вызывается при отрисовке
     * как компонент, поэтому хуки внутри неё недопустимы: хуки используют в возвращаемом компоненте.
     */
    readonly expandedRow?: ((row: Record<string, unknown>, index: number) => ReactNode) | undefined;
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
 * Табличная часть формы: таблица дизайн-системы (`DataTable`), каждая ячейка которой —
 * ячейка с двумя режимами (`TableCell`): значение показывается текстом, а поле ввода из реестра
 * виджетов появляется на его месте, только пока ячейка редактируется.
 *
 * Компонент получает только описание табличной части и работает внутри формы Ant Design:
 * значение ячейки лежит в форме по пути «табличная часть, номер строки, поле». Сервер называет
 * поле с ошибкой таким же путём, поэтому его ошибки сопоставляются с ячейками напрямую.
 * Enter в поле переходит к редактированию следующей ячейки, а в последней ячейке последней
 * строки добавляет строку; открытый список выбора или календарь получает Enter сам. При выходе
 * назад из первой ячейки компонент возвращает управление форме.
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

/** Виды полей, значения которых прижимаются к правому краю ячейки, как принято для чисел. */
const rightAligned: ReadonlySet<FormField['kind']> = new Set(['number', 'money']);

/** Размер колонки номера строки: до трёх цифр. */
const lineNumberSize: ColumnSize = { minimum: 3 };

/** Сдвиг по строкам и колонкам для стрелок в режиме просмотра. */
const arrows: { readonly [Key in string]?: readonly [number, number] } = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };

/**
 * Фокус ячеек хранится по устойчивому ключу строки, поэтому удаление строки не сдвигает
 * ссылки на поля остальных строк. Новая строка получает фокус после регистрации её полей.
 * Редактируется не больше одной ячейки: её имя хранит таблица.
 */
function RowTable({ part, disabled = false, showTitle = true, ref, onPrevious, rows, add, remove, columnSizes, layouts, columnInputs, addTitle = 'Добавить строку', addIcon = <Icons.add />, initialRow = false, newRow, totals = [], hiddenColumns = [], fixedRows = false, expandedRow }: RowTableProperties) {
    const form = Form.useFormInstance();
    const watched: unknown = Form.useWatch(part.name, { form, preserve: true });
    const values = (Array.isArray(watched) ? watched : form.getFieldValue(part.name) ?? []) as Record<string, unknown>[];
    const expanded = part.columns.filter((column) => column.expandedTablePart && column.target);
    const [expandedKeys, setExpandedKeys] = useState<ReadonlyArray<Key>>([]);
    // Строки с `expandedRow` раскрыты изначально, поэтому хранится то, что свернул пользователь:
    // новая строка раскрыта без отдельного учёта.
    const [collapsedKeys, setCollapsedKeys] = useState<ReadonlyArray<Key>>([]);
    const [editing, setEditing] = useState<string | null>(null);
    const cells = useFieldFocus();
    const pendingRow = useRef<number | null>(null);
    // Порядок обхода следует за порядком на экране: по схеме отображения текущей точки перелома.
    const point = useBreakpoint();
    const screenOrder = columnGroups(part.columns.map((column) => column.name), tableLayoutAt(layouts, point)).flat();
    const inputColumns = screenOrder
        .flatMap((name) => part.columns.find((column) => column.name === name) ?? [])
        .filter((column) => !column.readOnly && hasInput(column));
    const cellName = (row: Row, column: string) => `${row.key}/${column}`;
    // Ячейка с собственным полем или флажком режимов не имеет: фокус сразу получает её поле.
    const direct = (column: FormField) => columnInputs?.[column.name] !== undefined || column.kind === 'boolean';
    /** Переводит фокус на ячейку; `edit` сразу открывает её поле, иначе фокус получает значение. */
    const focusCell = (rowIndex: number, columnIndex: number, edit = true) => {
        const row = rows[rowIndex];
        const column = inputColumns[columnIndex];
        if (row === undefined || column === undefined) return;
        const name = cellName(row, column.name);
        if (edit && !direct(column)) setEditing(name);
        else {
            setEditing(null);
            cells.focus(name);
        }
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

    /**
     * Клавиши обхода. Обработчик стоит над таблицей и узнаёт ячейку по `data-cell-name`. Enter
     * в поле переходит к следующей ячейке, Shift+Enter — к предыдущей; стрелки в режиме просмотра
     * переводят фокус между значениями. Остальные клавиши ячейка обрабатывает сама.
     */
    const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
        if (disabled || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing) return;
        if (!(event.target instanceof HTMLElement) || hasOpenDialog(event.currentTarget) || hasOpenPicker(event.target)) return;
        const cell = event.target.closest<HTMLElement>('[data-cell-name]');
        const name = cell?.dataset['cellName'];
        if (cell === null || name === undefined) return;
        const [rowKey, columnName] = name.split('/');
        const rowIndex = rows.findIndex((row) => String(row.key) === rowKey);
        const columnIndex = inputColumns.findIndex((column) => column.name === columnName);
        if (rowIndex < 0 || columnIndex < 0) return;
        const viewing = cell.hasAttribute('data-cell-target');
        const arrow = arrows[event.key];
        if (viewing && arrow !== undefined && !event.shiftKey) {
            event.preventDefault();
            focusCell(rowIndex + arrow[0], columnIndex + arrow[1], false);
            return;
        }
        // Enter на значении начинает редактирование: его обрабатывает сама ячейка.
        if (event.key !== 'Enter' || viewing) return;
        if (event.target.closest('button, a') !== null) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (event.shiftKey) {
            if (columnIndex > 0) focusCell(rowIndex, columnIndex - 1);
            else if (rowIndex > 0) focusCell(rowIndex - 1, inputColumns.length - 1);
            else {
                setEditing(null);
                onPrevious?.();
            }
        } else if (columnIndex < inputColumns.length - 1) focusCell(rowIndex, columnIndex + 1);
        else if (rowIndex < rows.length - 1) focusCell(rowIndex + 1, 0);
        else addRow();
    };

    // Схемы конфигурации называют только колонки данных: номер строки всегда первый, удаление — последнее.
    const layoutsWithService = layouts === undefined ? undefined : Object.fromEntries(Object.entries(layouts)
        .map(([point, layout]) => [point, ['lineNumber', ...layout, 'remove']])) as TableLayouts;
    // Колонка удаления строки есть, только если строки можно удалять.
    const removable = !disabled && !fixedRows;
    const columns: DataTableColumn<Row>[] = [
        {
            key: 'lineNumber', title: '№', size: lineNumberSize, align: 'end',
            // Скрытые колонки регистрируются невидимыми полями: форма отдаёт при записи только
            // зарегистрированные поля, и без них значения скрытых колонок не дошли бы до сервера.
            render: (row, index) => <>{index + 1}{hiddenColumns.map((name) => <Form.Item key={name} name={[row.name, name]} hidden noStyle />)}</>,
        },
        ...part.columns.map((column): DataTableColumn<Row> => ({
            key: column.name,
            size: columnSizes?.[column.name] ?? fieldColumnSize(column),
            align: rightAligned.has(column.kind) ? 'end' : 'start',
            title: <span>{column.title}{isMarkedRequired(column) && <Typography.Text type="danger"> *</Typography.Text>}</span>,
            render: (row) => {
                const name = cellName(row, column.name);
                return (
                    <Form.Item name={[row.name, column.name]} rules={fieldRules(column)} noStyle>
                        {column.readOnly || !hasInput(column)
                            ? <FieldDisplay field={column} />
                            : <TableCell
                                name={name}
                                field={column}
                                input={columnInputs?.[column.name]}
                                disabled={disabled}
                                editing={editing === name}
                                onEdit={() => setEditing(name)}
                                onLeave={() => setEditing((current) => (current === name ? null : current))}
                                ref={cells.register(name)}
                            />}
                    </Form.Item>
                );
            },
        })),
    ];
    if (removable) columns.push({
        key: 'remove', title: '', size: 'control',
        render: (row) => <Button type="text" icon={<Icons.removeRow />} aria-label="Удалить строку" onClick={() => remove(row.name)} />,
    });
    // Подпись «Итого» стоит в первой колонке без суммы.
    const labelColumn = part.columns.find((column) => !totals.includes(column.name))?.name;
    const summary = totals.length === 0 || rows.length === 0 ? undefined : Object.fromEntries(part.columns.flatMap((column): [string, ReactNode][] => {
        if (totals.includes(column.name)) {
            const sum = values.reduce((total, row) => total + (typeof row[column.name] === 'number' ? row[column.name] as number : 0), 0);
            return [[column.name, <FieldDisplay key={column.name} field={column} value={sum} />]];
        }
        return column.name === labelColumn ? [[column.name, 'Итого']] : [];
    }));
    const expansion: DataTableExpansion<Row> | undefined = expandedRow !== undefined ? {
        isExpandable: (row) => expandedRow(values[row.name] ?? {}, row.name) !== null,
        isExpanded: (row) => !collapsedKeys.includes(row.key),
        onToggle: (row, _index, open) => setCollapsedKeys((keys) => (open ? keys.filter((key) => key !== row.key) : [...keys, row.key])),
        render: (row) => expandedRow(values[row.name] ?? {}, row.name),
    } : expanded.length === 0 ? undefined : {
        isExpandable: (row) => expanded.some((column) => typeof values[row.name]?.[column.name] === 'string'),
        isExpanded: (row) => expandedKeys.includes(row.key),
        onToggle: (row, _index, open) => setExpandedKeys((keys) => (open ? [...keys, row.key] : keys.filter((key) => key !== row.key))),
        render: (row) => (
            <Stack gap={3}>
                {expanded.filter((column) => typeof values[row.name]?.[column.name] === 'string').map((column) => <RecordTablePart key={column.name} object={column.target!} guid={String(values[row.name]?.[column.name])} part={column.expandedTablePart!} />)}
            </Stack>
        ),
    };
    return (
        <Stack gap={3} align="stretch">
            {showTitle && <TablePartTitle>{part.title}</TablePartTitle>}
            <div data-table-part={part.name} onKeyDownCapture={onKeyDownCapture}>
                <DataTable<Row>
                    columns={columns}
                    rows={rows}
                    rowKey={(row) => row.key}
                    layouts={layoutsWithService}
                    expansion={expansion}
                    summary={summary}
                    interactive={!disabled}
                />
            </div>
            {!disabled && !fixedRows && <div><Button icon={addIcon} onClick={addRow}>{addTitle}</Button></div>}
        </Stack>
    );
}
