import { Form } from 'antd';
import { useEffect, useRef, type ReactNode } from 'react';
import type { RecordOf } from '../../server/metadata/index';
import { Column, FieldInput, Grid, newRowValues, Stack, TablePart, Text, useFormValue, type EnteredValue, type TablePartInputProperties, type TablePartOptions } from '../../web/sdk';
import type { Sale } from '../documents/sale.document';
import { Objects } from '../objects.generated';
import { PaymentMethodIcons, UnavailablePaymentMethods } from './payment-method-input';

/** Строка оплаты на форме: до записи любая ячейка может быть не заполнена. */
type PaymentLine = EnteredValue<RecordOf<typeof Sale>['payments']>[number];

/**
 * Способ оплаты, по которому деньги не приняты. Совпадает с `installmentMethod` из `payments.ts`;
 * константа оттуда не импортируется, потому что это серверный модуль, а компонент собирается в клиент.
 */
const installmentMethod = 'Рассрочка';
/** Недоступные способы строк оплат: постоянные массивы, чтобы контекст не менялся при каждой отрисовке. */
const installmentOnly = [installmentMethod];
const noMethods: ReadonlyArray<string> = [];

/**
 * Колонки простой оплаты в сетке оплат. Ширину всех оплат задаёт колонка формы продажи, поэтому
 * поля не растягиваются на всю форму. Сумме хватает двух колонок, остальное получает «Куда оплачено».
 */
const simpleColumns = { amount: { md: 2 }, receiver: { md: 6, lg: 14 } } as const;

/**
 * Размеры колонок таблицы оплат. Способ выбирается кнопками из одних значков, и колонка
 * не растёт сверх их ширины; сумма получает размер по виду поля, а остаток — «Куда оплачено».
 */
const columnSizes = { method: { minimum: 18 } };

/**
 * Поле с подписью над ним. Подпись и ошибки самой части показывает форма. Ширину поле получает
 * от колонки сетки; обёртка нужна только для `onBlur`, который `Stack` не принимает.
 */
function Labelled({ title, onBlur, children }: { readonly title: string; readonly onBlur?: () => void; readonly children: ReactNode }) {
    return (
        <div {...(onBlur === undefined ? {} : { onBlur })}>
            <Stack gap={2}>
                <Text tone="secondary">{title}</Text>
                {children}
            </Stack>
        </div>
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
 * В таблице способ строки выбирается кнопками из одних значков, название способа в подсказке.
 * Способ «Рассрочка» выбирается не больше чем в одной строке: в остальных он недоступен. Первая строка сложной оплаты пустая,
 * а каждая следующая получает сумму, которую осталось оплатить: продавцу не нужно считать
 * остаток самому.
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

    // Отказ сервера по полю строки форма отмечает на всей части: при простом способе ячеек нет.
    // Тогда красным выделяется только незаполненное поле, а заполненное отметку не получает.
    // Если незаполненного нет, отметка части остаётся на обоих полях: статус не задаётся.
    const { status } = Form.Item.useStatus();
    const receiverMissing = status === 'error' && mode !== installmentMethod && (row?.receiver ?? null) === null;
    const amountMissing = status === 'error' && (row?.amount ?? null) === null;
    const fieldStatus = (missing: boolean) => receiverMissing || amountMissing ? { validateStatus: missing ? 'error' as const : '' as const } : {};

    if (!simple) {
        // У продажи не больше одной оплаты рассрочкой: когда она есть, в остальных строках способ недоступен.
        const installmentTaken = rows.some((payment) => payment.method === installmentMethod);
        const options: TablePartOptions = {
            columnSizes,
            columnInputs: { method: PaymentMethodIcons },
            addTitle: 'Оплата',
            newRow: () => ({ ...newRowValues(part), amount: rows.length > 0 && remaining > 0 ? remaining : null }),
        };
        return (
            <UnavailablePaymentMethods value={installmentTaken ? installmentOnly : noMethods}>
                <TablePart showTitle={false} part={part} disabled={disabled} ref={ref} onPrevious={onPrevious} {...options} />
            </UnavailablePaymentMethods>
        );
    }
    return (
        <Grid gutter="narrow">
            <Column span={simpleColumns.amount}>
                <Labelled title={amount.title} onBlur={fillEmptyAmount}>
                    {/* `Form.Item` без имени только задаёт статус поля: пустой статус снимает отметку части. */}
                    <Form.Item noStyle {...fieldStatus(amountMissing)}>
                        <FieldInput field={amount} value={row?.amount ?? null} disabled={disabled} ref={ref} id={id}
                            onChange={(entered) => onChange?.(single({ amount: typeof entered === 'number' ? entered : null }))} />
                    </Form.Item>
                </Labelled>
            </Column>
            {/* По оплате способом «Рассрочка» деньги не приняты, и «Куда оплачено» у неё не заполняется. */}
            {mode !== installmentMethod && (
                <Column span={simpleColumns.receiver}>
                    <Labelled title={receiver.title}>
                        <Form.Item noStyle {...fieldStatus(receiverMissing)}>
                            <FieldInput field={receiver} value={row?.receiver ?? null} disabled={disabled}
                                onChange={(entered) => onChange?.(single({ receiver: (entered ?? null) as PaymentLine['receiver'] }))} />
                        </Form.Item>
                    </Labelled>
                </Column>
            )}
        </Grid>
    );
}
