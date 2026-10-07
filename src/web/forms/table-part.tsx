import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Flex, Form, Table, Typography, type TableProps } from 'antd';
import { useImperativeHandle, useRef, type Ref } from 'react';
import type { FormTablePart } from '../../server/ui/descriptions';
import { FieldInput } from '../widgets/registry';
import { fieldRules, isMarkedRequired } from '../widgets/validation';
import type { InputHandle } from '../widgets/widget';
import { newRowValues } from './record-values';

interface TablePartProperties {
    readonly part: FormTablePart;
    /** Строки нельзя изменять, добавлять и удалять: форма открыта только для просмотра. */
    readonly disabled: boolean;
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
 * От остальной формы компонент не зависит, и его можно заменить целиком, например таблицей
 * с переходом между ячейками с клавиатуры.
 *
 * Строки записываются в том порядке, в котором стоят на форме: сервер при записи заменяет
 * строки целиком.
 */
export function TablePart({ part, disabled, ref }: TablePartProperties) {
    const firstCell = useRef<InputHandle>(null);
    const addButton = useRef<HTMLButtonElement>(null);
    // В табличной части без строк ячеек нет, поэтому фокус получает кнопка добавления строки.
    useImperativeHandle(ref, () => ({ focus: () => (firstCell.current ?? addButton.current)?.focus() }), []);

    return (
        <Form.List name={part.name}>
            {(rows, { add, remove }) => {
                const columns: NonNullable<TableProps<Row>['columns']> = [
                    { key: 'lineNumber', title: '№', width: 48, render: (_value, _row, index) => index + 1 },
                    ...part.columns.map((column, columnIndex) => ({
                        key: column.name,
                        title: (
                            <>
                                {column.title}
                                {isMarkedRequired(column) && <Typography.Text type="danger"> *</Typography.Text>}
                            </>
                        ),
                        render: (_value: unknown, row: Row, rowIndex: number) => (
                            // Отступ элемента формы убран, чтобы строки таблицы не были выше полей ввода.
                            // Сообщение об ошибке выводится под полем в той же ячейке.
                            <Form.Item name={[row.name, column.name]} rules={fieldRules(column)} style={{ margin: 0 }}>
                                <FieldInput field={column} ref={rowIndex === 0 && columnIndex === 0 ? firstCell : undefined} />
                            </Form.Item>
                        ),
                    })),
                ];
                if (!disabled) {
                    columns.push({
                        key: 'remove',
                        width: 48,
                        render: (_value, row) => <Button type="text" icon={<DeleteOutlined />} aria-label="Удалить строку" onClick={() => remove(row.name)} />,
                    });
                }
                return (
                    <Flex vertical gap="small" align="flex-start">
                        <Typography.Text strong>{part.title}</Typography.Text>
                        <Table<Row>
                            size="small"
                            style={{ width: '100%' }}
                            rowKey="key"
                            columns={columns}
                            dataSource={rows}
                            pagination={false}
                            locale={{ emptyText: 'Строк нет' }}
                        />
                        {!disabled && (
                            <Button ref={addButton} icon={<PlusOutlined />} onClick={() => add(newRowValues(part))}>
                                Добавить строку
                            </Button>
                        )}
                    </Flex>
                );
            }}
        </Form.List>
    );
}
