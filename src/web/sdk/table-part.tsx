import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Form, Table, Typography, type TableProps } from 'antd';
import { useImperativeHandle, useLayoutEffect, useRef, type Ref } from 'react';
import type { FormTablePart } from '../../server/ui/descriptions';
import { FieldInput, hasInput } from '../widgets/registry';
import { fieldRules, isMarkedRequired } from '../widgets/validation';
import type { InputHandle } from '../widgets/widget';
import { useFieldFocus } from './field-focus';
import { hasOpenDialog, hasOpenPicker } from './keyboard';
import { newRowValues } from './record-values';

/** Свойства табличной части. */
export interface TablePartProperties {
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
    return (
        <Form.List name={properties.part.name}>
            {(rows, { add, remove }) => <RowTable {...properties} rows={rows} add={() => add(newRowValues(properties.part))} remove={remove} />}
        </Form.List>
    );
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
function RowTable({ part, disabled = false, ref, onPrevious, rows, add, remove }: RowTableProperties) {
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
        if (disabled || inputColumns.length === 0 || pendingRow.current !== null) return;
        pendingRow.current = rows.length;
        add();
    };
    useLayoutEffect(() => {
        if (pendingRow.current === null || rows[pendingRow.current] === undefined) return;
        focusCell(pendingRow.current, 0);
        pendingRow.current = null;
    });
    useImperativeHandle(ref, () => ({
        focus: () => {
            if (disabled) return;
            if (rows.length === 0) addRow();
            else focusCell(0, 0);
        },
    }));

    const columns: NonNullable<TableProps<Row>['columns']> = [
        { key: 'lineNumber', title: '№', width: 48, render: (_value, _row, index) => index + 1 },
        ...part.columns.map((column) => ({
            key: column.name,
            title: <>{column.title}{isMarkedRequired(column) && <Typography.Text type="danger"> *</Typography.Text>}</>,
            render: (_value: unknown, row: Row, rowIndex: number) => (
                <div onKeyDownCapture={(event) => {
                    if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || disabled || hasOpenDialog() || hasOpenPicker(event.target)) return;
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
                        <FieldInput field={column} ref={cells.register(cellName(row, column.name))} />
                    </Form.Item>
                </div>
            ),
        })),
    ];
    if (!disabled) columns.push({
        key: 'remove', width: 48,
        render: (_value, row) => <Button type="text" icon={<DeleteOutlined />} aria-label="Удалить строку" onClick={() => remove(row.name)} />,
    });
    return (
        <Flex vertical gap="small" align="flex-start" data-table-part={part.name}>
            <Typography.Text strong>{part.title}</Typography.Text>
            <Table<Row> size="small" style={{ width: '100%' }} rowKey="key" columns={columns} dataSource={[...rows]} pagination={false} locale={{ emptyText: 'Строк нет' }} />
            {!disabled && <Button icon={<PlusOutlined />} onClick={addRow}>Добавить строку</Button>}
        </Flex>
    );
}
