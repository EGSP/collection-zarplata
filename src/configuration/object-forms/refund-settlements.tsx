/**
 * Расчёты возврата на форме: ожидаемая выдача над таблицей расчётов, предупреждения по продаже
 * под её строкой в основаниях, автозаполнение расчётов при отметке товаров и подстановка
 * «Откуда выдано». Правила расчётов проверяет сервер
 * (`refund.document.ts`); форма считает то же по тем же условиям, чтобы продавец видел итог до записи.
 */
import { Alert, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Stack, useActionResult, useFormData, useFormValue, type TablePartOptions } from '../../web/sdk';
import { PaymentMethodIcons } from '../form-elements/payment-method-input';
import { PaymentReceiverDefaults } from '../form-elements/payment-receiver-default';
import { Objects } from '../objects.generated';

/**
 * Способы расчёта и оплаты. Совпадают со значениями в `payments.ts`: тот модуль серверный,
 * а компонент собирается в клиент. «В счёт долга» гасит долг по рассрочке, «Рассрочка» — способ
 * оплаты продажи, о котором сообщает предупреждение о неоформленной рассрочке.
 */
const cash = 'Наличные';
const debtSettlement = 'В счёт долга';
const installmentMethod = 'Рассрочка';
const ownInstallment = 'Собственная';

/** Сумма в копейках рублями со знаком валюты, как `rubles` из `money.ts`. */
const rubles = (kopecks: number) => `${(kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/**
 * Условия расчёта по продаже: ответ действия `settlementTerms`, описанный в `refund.document.ts`.
 * Ожидаемую выдачу за товары на `total` считает сервер тем же расчётом, что проверяет возврат.
 */
interface SettlementTerms {
    readonly total: number;
    readonly payout: { readonly expected: number; readonly bankShare: number };
    readonly unarranged: number;
    readonly installment: {
        readonly number: string;
        readonly date: string;
        readonly type: string | null;
        readonly posted: boolean;
        readonly closed: boolean;
        readonly balance: number;
    } | null;
}

/** Строка расчёта на форме: до записи любая ячейка может быть не заполнена. */
interface SettlementRow {
    readonly sale: string | null;
    readonly method: string | null;
    readonly amount: number | null;
    readonly receiver?: unknown;
}

/**
 * Таблица расчётов: способ выбирается кнопками из значков, как в оплатах продажи. Порядок колонок
 * задаёт чтение строки: по какой продаже, каким способом, сколько и откуда выдано.
 */
export const settlementsOptions: TablePartOptions = {
    columnSizes: { method: { minimum: 18 } },
    columnInputs: { method: PaymentMethodIcons },
    columnOrder: ['sale', 'method', 'amount', 'receiver'],
    addTitle: 'Расчёт',
};

/**
 * Можно ли погасить возвратом долг по рассрочке продажи: только проведённая собственная рассрочка,
 * которая не закрыта и у которой есть остаток. Банковскую рассрочку банк уже оплатил.
 */
const creditable = (terms: SettlementTerms) => {
    const installment = terms.installment;
    return installment !== null && installment.posted && !installment.closed && installment.type === ownInstallment && installment.balance > 0;
};

/**
 * Условия расчёта по продаже для отмеченных в возврате товаров этой продажи. Пока ответ на новый
 * итог товаров не пришёл, возвращается `undefined`: прежний ответ посчитан для других товаров.
 * Запрос одинаков у предупреждений по продаже и у строки «К выдаче клиенту», поэтому SDK
 * выполняет его один раз.
 */
function useSettlementTerms(sale: string) {
    const refunds = Objects.document.refund;
    const form = useFormData(refunds);
    const goods = useFormValue(refunds, 'goods');
    const total = goods.filter((line) => line.sale === sale).reduce((sum, line) => sum + (line.total ?? 0), 0);
    const result = useActionResult<SettlementTerms>({
        object: refunds, action: 'settlementTerms',
        payload: { sale, total, ...(form.saved === null ? {} : { excludedRefund: form.saved['guid'] }) },
    }).data;
    return { total, terms: result !== undefined && result.total === total ? result : undefined };
}

/**
 * Предупреждения по продаже под её строкой в основаниях возврата: неоформленная рассрочка
 * и расхождение расчётов с ожидаемой выдачей. Обычный возврат ничего здесь не выводит.
 *
 * Когда продавец меняет отмеченные товары продажи, строки расчёта этой продажи заполняются
 * заново: сначала в счёт остатка долга по собственной рассрочке, остальное наличными. Так покупатель
 * с долгом не получает деньги, пока долг не погашен. Расчёты других продаж не меняются,
 * а при открытии записанного возврата его расчёты остаются прежними.
 */
export function RefundSaleSettlement({ sale }: { readonly sale: string }) {
    const refunds = Objects.document.refund;
    const form = useFormData(refunds);
    const settlements = useFormValue(refunds, 'settlements') as ReadonlyArray<SettlementRow>;
    const { total, terms } = useSettlementTerms(sale);
    const payout = terms?.payout ?? null;

    // Расчёты заполняются при изменении итога товаров, а не при открытии формы. Если условия
    // ещё не прочитаны, заполнение ждёт их.
    const previousTotal = useRef(total);
    const pending = useRef(false);
    useEffect(() => {
        if (previousTotal.current !== total) {
            previousTotal.current = total;
            pending.current = true;
        }
        if (!pending.current || terms === undefined || payout === null || form.readOnly) return;
        pending.current = false;
        const credit = creditable(terms) ? Math.min(payout.expected, terms.installment!.balance) : 0;
        const money = payout.expected - credit;
        form.setValue('settlements', (current) => {
            const rows = current as ReadonlyArray<SettlementRow>;
            // Выбранный продавцом приёмник наличных сохраняется: строка меняет только сумму.
            const previousCash = rows.find((row) => row.sale === sale && row.method === cash);
            const next: SettlementRow[] = [
                ...credit > 0 ? [{ sale, method: debtSettlement, amount: credit, receiver: null }] : [],
                ...money > 0 ? [{ sale, method: cash, amount: money, receiver: previousCash?.receiver ?? null }] : [],
            ];
            return [...rows.filter((row) => row.sale !== sale), ...next] as never;
        }, { validate: false });
    }, [total, terms, payout?.expected, form.readOnly]);

    if (terms === undefined || payout === null) return null;
    const lines = settlements.filter((row) => row.sale === sale);
    const settled = lines.reduce((sum, row) => sum + (row.amount ?? 0), 0);
    const difference = payout.expected - settled;
    const unarranged = terms.unarranged > 0;
    const less = total > 0 && difference > 0;
    if (!unarranged && !less && difference >= 0) return null;
    return (
        <Stack gap={3}>
            {unarranged && (
                <Alert type="error" showIcon title={`Оплата «${installmentMethod}» ${rubles(terms.unarranged)} не оформлена проведённой рассрочкой: возврат не проведётся, пока рассрочку не оформят и не проведут.`} />
            )}
            {less && (
                <Alert type="warning" showIcon title={`Магазин выдаёт на ${rubles(difference)} меньше ожидаемого. Если это не удержание, добавьте строку расчёта наличными или безналичными.`} />
            )}
            {difference < 0 && <Alert type="error" showIcon title={`Расчёты больше ожидаемой выдачи на ${rubles(-difference)}: возврат не проведётся.`} />}
        </Stack>
    );
}

/**
 * Подставляет «Откуда выдано» строкам расчёта деньгами по способу, как «Куда оплачено» в оплатах
 * продажи. У строки «В счёт долга» поле очищается: деньги не выдаются.
 */
export function RefundSettlementDefaults() {
    const refunds = Objects.document.refund;
    const form = useFormData(refunds);
    const rows = useFormValue(refunds, 'settlements') as ReadonlyArray<SettlementRow>;
    return <PaymentReceiverDefaults rows={rows} initialize={form.saved === null} disabled={form.readOnly}
        onChange={(index, receiver) => form.setValue('settlements', (current) =>
            (current as ReadonlyArray<SettlementRow>).map((row, position) => position === index ? { ...row, receiver } : row) as never, { validate: false })} />;
}

/** Ожидаемая выдача по одной продаже: сообщает сумму родителю и ничего не выводит. */
function SalePayout({ sale, onChange }: { readonly sale: string; readonly onChange: (sale: string, payout: SettlementTerms['payout'] | null) => void }) {
    const { terms } = useSettlementTerms(sale);
    const payout = terms?.payout ?? null;
    useEffect(() => {
        onChange(sale, payout);
    }, [sale, payout?.expected, payout?.bankShare]);
    useEffect(() => () => onChange(sale, null), [sale]);
    return null;
}

/**
 * Строка «К выдаче клиенту» над таблицей расчётов: сколько покупатель может ожидать за отмеченные
 * товары по всем продажам, с удержанием банка по банковской рассрочке. Сумму считает сервер
 * (`settlementTerms`), тем же расчётом, которым проведение ограничивает расчёты. Пока ответ хотя бы
 * по одной продаже не пришёл, строка не выводится, чтобы не показывать неполную сумму.
 */
export function RefundPayout() {
    const refunds = Objects.document.refund;
    const bases = useFormValue(refunds, 'bases') as ReadonlyArray<{ readonly sale?: unknown }>;
    const sales = [...new Set(bases.map((row) => row.sale).filter((sale): sale is string => typeof sale === 'string'))];
    const [payouts, setPayouts] = useState<ReadonlyMap<string, SettlementTerms['payout']>>(new Map());
    const update = (sale: string, payout: SettlementTerms['payout'] | null) => setPayouts((current) => {
        const next = new Map(current);
        if (payout === null) next.delete(sale); else next.set(sale, payout);
        return next;
    });
    const known = sales.map((sale) => payouts.get(sale));
    const complete = known.every((payout) => payout !== undefined);
    const expected = known.reduce((sum, payout) => sum + (payout?.expected ?? 0), 0);
    const bankShare = known.reduce((sum, payout) => sum + (payout?.bankShare ?? 0), 0);
    return <>
        {sales.map((sale) => <SalePayout key={sale} sale={sale} onChange={update} />)}
        {sales.length > 0 && complete && (
            <Typography.Text>
                К выдаче клиенту: {rubles(expected)}{bankShare > 0 ? ` (банк удерживает ${rubles(bankShare)})` : ''}
            </Typography.Text>
        )}
    </>;
}
