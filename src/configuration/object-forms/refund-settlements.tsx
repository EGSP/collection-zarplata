/**
 * Расчёты возврата на форме: сводка по продаже под её строкой в основаниях, автозаполнение
 * расчётов при отметке товаров и подстановка «Куда выдано». Правила расчётов проверяет сервер
 * (`refund.document.ts`); форма считает то же по тем же условиям, чтобы продавец видел итог до записи.
 */
import { Alert, Typography } from 'antd';
import { useEffect, useRef } from 'react';
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
 * задаёт чтение строки: по какой продаже, каким способом, сколько и куда выдано.
 */
export const settlementsOptions: TablePartOptions = {
    columnSizes: { method: { minimum: 18 } },
    columnInputs: { method: PaymentMethodIcons },
    columnOrder: ['sale', 'method', 'amount', 'receiver'],
    addTitle: 'Расчёт',
};

/** Название рассрочки в тексте: номер и день, как в её представлении. */
const installmentName = (installment: NonNullable<SettlementTerms['installment']>) => `№ ${installment.number} от ${new Date(installment.date).toLocaleDateString('ru-RU')}`;

/**
 * Можно ли погасить возвратом долг по рассрочке продажи: только проведённая собственная рассрочка,
 * которая не закрыта и у которой есть остаток. Банковскую рассрочку банк уже оплатил.
 */
const creditable = (terms: SettlementTerms) => {
    const installment = terms.installment;
    return installment !== null && installment.posted && !installment.closed && installment.type === ownInstallment && installment.balance > 0;
};

/**
 * Расчёты по продаже под её строкой в основаниях возврата. Показывает итог отмеченных товаров,
 * ожидаемую выдачу с удержанием банка, сумму расчётов и расхождение, а также остаток рассрочки,
 * который можно погасить возвратом.
 *
 * Когда продавец меняет отмеченные товары продажи, строки расчёта этой продажи заполняются
 * заново: сначала в счёт остатка долга по собственной рассрочке, остальное наличными. Так покупатель
 * с долгом не получает деньги, пока долг не погашен. Расчёты других продаж не меняются,
 * а при открытии записанного возврата его расчёты остаются прежними.
 */
export function RefundSaleSettlement({ sale }: { readonly sale: string }) {
    const refunds = Objects.document.refund;
    const form = useFormData(refunds);
    const goods = useFormValue(refunds, 'goods');
    const settlements = useFormValue(refunds, 'settlements') as ReadonlyArray<SettlementRow>;
    const total = goods.filter((line) => line.sale === sale).reduce((sum, line) => sum + (line.total ?? 0), 0);
    const result = useActionResult<SettlementTerms>({
        object: refunds, action: 'settlementTerms',
        payload: { sale, total, ...(form.saved === null ? {} : { excludedRefund: form.saved['guid'] }) },
    }).data;
    // Пока ответ на новый итог не пришёл, прежний ответ не используется: его выдача посчитана для других товаров.
    const terms = result !== undefined && result.total === total ? result : undefined;
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
    const credited = lines.filter((row) => row.method === debtSettlement).reduce((sum, row) => sum + (row.amount ?? 0), 0);
    const installment = terms.installment;
    const difference = payout.expected - settled;
    return (
        <Stack gap={3}>
            <Typography.Text>
                Товары на {rubles(total)}. К выдаче {rubles(payout.expected)}
                {payout.bankShare > 0 ? ` (банк удерживает ${rubles(payout.bankShare)})` : ''}. В расчётах {rubles(settled)}.
            </Typography.Text>
            {terms.unarranged > 0 && (
                <Alert type="error" showIcon title={`Оплата «${installmentMethod}» ${rubles(terms.unarranged)} не оформлена проведённой рассрочкой: возврат не проведётся, пока рассрочку не оформят и не проведут.`} />
            )}
            {total > 0 && difference > 0 && (
                <Alert type="warning" showIcon title={`Магазин выдаёт на ${rubles(difference)} меньше ожидаемого. Если это не удержание, добавьте строку расчёта наличными или безналичными.`} />
            )}
            {difference < 0 && <Alert type="error" showIcon title={`Расчёты больше ожидаемой выдачи на ${rubles(-difference)}: возврат не проведётся.`} />}
            {installment !== null && installment.type === ownInstallment && installment.posted && (
                <Typography.Text type="secondary">
                    {installment.closed
                        ? `Рассрочка ${installmentName(installment)} закрыта: долг погашен, возврат выдаётся деньгами.`
                        : `Остаток рассрочки ${installmentName(installment)}: ${rubles(installment.balance)}. Пока долг не погашен, возврат идёт в счёт долга, а не выдаётся деньгами.`}
                </Typography.Text>
            )}
            {credited > 0 && (
                <Alert type="info" showIcon title={`Возврат погасит ${rubles(credited)} долга по рассрочке. Если потом изменить или отменить этот возврат, долг снова вырастет, и закрытая рассрочка откроется: её нужно будет закрыть заново.`} />
            )}
        </Stack>
    );
}

/**
 * Подставляет «Куда выдано» строкам расчёта деньгами по способу, как «Куда оплачено» в оплатах
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
