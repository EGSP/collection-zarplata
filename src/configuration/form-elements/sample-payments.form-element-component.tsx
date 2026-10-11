import { Button, Flex } from 'antd';
import { useState } from 'react';
import { FieldInput, newRowValues, TablePart, type TablePartInputProperties } from '../../web/sdk';

/** Строка пробной оплаты; вычисляемую сумму пересчитывает платформа. */
interface PaymentLine extends Record<string, unknown> {
    readonly method: string | null;
    readonly amount: number | null;
}

/**
 * Показывает одну сумму либо полную таблицу. Строки в обоих режимах принадлежат форме,
 * поэтому размонтирование таблицы не теряет ввод. При нескольких строках сокращённый
 * режим недоступен: одно поле не могло бы сохранить смысл отдельных оплат.
 */
export default function SamplePayments({ part, value, onChange, disabled, ref, id, onPrevious }: TablePartInputProperties<PaymentLine>) {
    const [expanded, setExpanded] = useState(false);
    const rows = value ?? [];
    const amount = part.columns.find((column) => column.name === 'amount');
    if (amount === undefined) throw new Error('В части оплаты нет колонки суммы');
    const full = expanded || rows.length > 1;
    return (
        <Flex vertical gap="small">
            {full
                ? <TablePart showTitle={false} part={part} disabled={disabled} ref={ref} onPrevious={onPrevious} />
                : <FieldInput field={amount} value={rows[0]?.amount ?? null} disabled={disabled} ref={ref} id={id}
                    onChange={(entered) => onChange?.([{ ...newRowValues(part), ...rows[0], method: rows[0]?.method ?? 'Наличные', amount: typeof entered === 'number' ? entered : null }])} />}
            <Button disabled={disabled || rows.length > 1} onClick={() => setExpanded(!full)}>
                {full ? 'Показать одну сумму' : 'Показать таблицу оплаты'}
            </Button>
        </Flex>
    );
}
