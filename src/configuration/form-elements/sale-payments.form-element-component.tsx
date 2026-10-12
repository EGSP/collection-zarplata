import { Flex, Typography } from 'antd';
import { useEffect, useRef, type ReactNode } from 'react';
import type { RecordOf } from '../../server/metadata/index';
import { FieldInput, newRowValues, TablePart, useFormValue, type EnteredValue, type TablePartInputProperties } from '../../web/sdk';
import type { Sale } from '../documents/sale.document';
import { Objects } from '../objects.generated';

/** Строка оплаты на форме: до записи любая ячейка может быть не заполнена. */
type PaymentLine = EnteredValue<RecordOf<typeof Sale>['payments']>[number];

/** Поле с подписью над ним. Подпись и ошибки самой части показывает форма. */
function Labelled({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <Flex vertical gap={4} style={{ flex: '1 1 280px', minWidth: 0 }}>
            <Typography.Text type="secondary">{title}</Typography.Text>
            {children}
        </Flex>
    );
}

/**
 * Оплаты продажи на месте табличной части. При простом способе оплаты, «Наличные» или
 * «Безналичные», элемент показывает два поля, «Сумма» и «Куда оплачено», и хранит их единственной
 * строкой части со способом шапки. При способе «Сложная» он показывает полную таблицу оплат.
 * Строки в обоих видах принадлежат форме, поэтому смена вида ввод не теряет. Приводит строки
 * к способу при его смене элемент `SalePaymentMode`.
 *
 * Сумма простой оплаты следует за суммой продажи, пока продавец не ввёл своё значение. Признак
 * отдельно не хранится: сумма следует, пока равна прежней сумме продажи. Поэтому сумма,
 * исправленная вручную, при изменении товаров остаётся прежней, а возвращённая к сумме продажи
 * снова следует за ней. При открытии записанной продажи оплата не меняется: сумма продажи
 * в этот момент не изменяется.
 *
 * Простым считается способ, который есть среди способов строки оплаты. Продажа без способа,
 * записанная до появления оплат, показывает таблицу.
 */
export default function SalePayments({ part, value, onChange, disabled, ref, id, onPrevious }: TablePartInputProperties<PaymentLine>) {
    const sales = Objects.document.sale;
    const mode = useFormValue(sales, 'paymentMode');
    const saleAmount = useFormValue(sales, 'amount') ?? 0;
    const rows = value ?? [];
    const amount = part.columns.find((column) => column.name === 'amount');
    const receiver = part.columns.find((column) => column.name === 'receiver');
    const method = part.columns.find((column) => column.name === 'method');
    if (amount === undefined || receiver === undefined || method === undefined) throw new Error('В части оплат нет колонок способа, суммы или приёмника');
    const simple = mode !== null && (method.choices ?? []).includes(mode);
    const row = rows[0];

    /** Единственная строка простой оплаты. Без суммы и приёмника строки нет: пустая строка не прошла бы проверку суммы. */
    const single = (changes: Partial<PaymentLine>): ReadonlyArray<PaymentLine> => {
        const next = { ...newRowValues(part), ...row, ...changes, method: mode } as PaymentLine;
        return next.amount === null && next.receiver === null ? [] : [next];
    };

    const previousSaleAmount = useRef(saleAmount);
    useEffect(() => {
        const before = previousSaleAmount.current;
        previousSaleAmount.current = saleAmount;
        if (!simple || disabled === true || before === saleAmount || rows.length > 1) return;
        // Сумма, которую продавец ввёл сам, отличается от прежней суммы продажи и за новой не следует.
        if ((row?.amount ?? 0) !== before) return;
        onChange?.(single({ amount: saleAmount > 0 ? saleAmount : null }));
        // Эффект отвечает только на изменение суммы продажи: остальные значения он читает текущими.
    }, [saleAmount]);

    if (!simple) return <TablePart showTitle={false} part={part} disabled={disabled} ref={ref} onPrevious={onPrevious} />;
    return (
        <Flex gap="middle" wrap>
            <Labelled title={amount.title}>
                <FieldInput field={amount} value={row?.amount ?? null} disabled={disabled} ref={ref} id={id}
                    onChange={(entered) => onChange?.(single({ amount: typeof entered === 'number' ? entered : null }))} />
            </Labelled>
            <Labelled title={receiver.title}>
                <FieldInput field={receiver} value={row?.receiver ?? null} disabled={disabled}
                    onChange={(entered) => onChange?.(single({ receiver: (entered ?? null) as PaymentLine['receiver'] }))} />
            </Labelled>
        </Flex>
    );
}
