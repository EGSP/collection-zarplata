import { Flex, Typography } from 'antd';
import { useEffect, useRef, type ReactNode } from 'react';
import type { RecordOf } from '../../server/metadata/index';
import { FieldInput, newRowValues, TablePart, useFormValue, type EnteredValue, type TablePartInputProperties, type TablePartOptions } from '../../web/sdk';
import type { Sale } from '../documents/sale.document';
import { Objects } from '../objects.generated';
import { PaymentMethodInput } from './payment-method-input';

/** Строка оплаты на форме: до записи любая ячейка может быть не заполнена. */
type PaymentLine = EnteredValue<RecordOf<typeof Sale>['payments']>[number];

/**
 * Наибольшая ширина оплат. Оплата — это несколько коротких значений, и растянутые на всю форму
 * поля читаются хуже: сумма оказывается далеко от способа.
 */
const paymentsWidth = 960;

/**
 * Ширины колонок таблицы оплат. Способ выбирается кнопками со значками, и колонка вмещает их все;
 * сумме хватает трети прежней ширины, а остальное получает «Куда оплачено».
 */
const columnWidths = { method: 360, amount: 150 };

/** Поле с подписью над ним. Подпись и ошибки самой части показывает форма. */
function Labelled({ title, flex = '1 1 280px', onBlur, children }: { readonly title: string; readonly flex?: string; readonly onBlur?: () => void; readonly children: ReactNode }) {
    return (
        <Flex vertical gap={4} style={{ flex, minWidth: 0 }} {...(onBlur === undefined ? {} : { onBlur })}>
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
 * Пустую сумму простой оплаты элемент заполняет суммой продажи: при изменении товаров, при смене
 * способа и когда продавец уходит из пустого поля. Сразу при стирании сумма не подставляется,
 * иначе она возвращалась бы посреди ввода нового значения. При сложной оплате пустые суммы
 * остаются пустыми: какую часть внести каким способом, решает продавец.
 *
 * Простым считается способ, который есть среди способов строки оплаты. Продажа без способа,
 * записанная до появления оплат, показывает таблицу.
 *
 * В таблице способ строки выбирается кнопками со значками. Первая строка сложной оплаты пустая,
 * а каждая следующая получает сумму, которую осталось оплатить: продавцу не нужно считать
 * остаток самому. Состояние оплаты выводит поле «Способ оплаты» справа от своих кнопок.
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

    const previous = useRef({ saleAmount, mode });
    useEffect(() => {
        const before = previous.current;
        previous.current = { saleAmount, mode };
        if (!simple || disabled === true || rows.length > 1) return;
        if (before.saleAmount === saleAmount && before.mode === mode) return;
        const current = row?.amount ?? null;
        // Сумма, которую продавец ввёл сам, отличается от прежней суммы продажи и за новой не следует.
        if (current !== null && current !== before.saleAmount) return;
        const next = saleAmount > 0 ? saleAmount : null;
        if (current !== next) onChange?.(single({ amount: next }));
        // Эффект отвечает только на изменение суммы продажи и способа: остальные значения он читает текущими.
    }, [saleAmount, mode]);

    /** Пустую сумму продавец оставил: подставляется сумма продажи. */
    const fillEmptyAmount = () => {
        if (disabled !== true && (row?.amount ?? null) === null && saleAmount > 0) onChange?.(single({ amount: saleAmount }));
    };

    const paid = rows.reduce((total, payment) => total + (payment.amount ?? 0), 0);
    const remaining = saleAmount - paid;

    if (!simple) {
        const options: TablePartOptions = {
            columnWidths,
            columnInputs: { method: PaymentMethodInput },
            addTitle: 'Оплата',
            newRow: () => ({ ...newRowValues(part), amount: rows.length > 0 && remaining > 0 ? remaining : null }),
        };
        return (
            <div style={{ maxWidth: paymentsWidth }}>
                <TablePart showTitle={false} part={part} disabled={disabled} ref={ref} onPrevious={onPrevious} {...options} />
            </div>
        );
    }
    return (
        <Flex gap="middle" wrap style={{ maxWidth: paymentsWidth }}>
            <Labelled title={amount.title} flex={`0 0 ${columnWidths.amount}px`} onBlur={fillEmptyAmount}>
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
