/**
 * Строки продаж и возвратов сводки за период по зонам 1С (раздел «Правила учёта», «Сводка за период»).
 *
 * Сводка показывает только фактические деньги: оплаты продажи, первоначальный взнос и выдачи возвратов.
 * Долг рассрочки и списание долга возвратом в суммы не входят. Строки плоские: продажа и возврат стоят
 * отдельно, а связь между ними передаётся списком ссылок `links`, который страница показывает
 * в раскрытой строке без сумм. Так каждый рубль учитывается в итоге ровно один раз.
 *
 * Итоги зоны делят возвраты по дням их продаж (`SummaryTotals`): часть возврата по продаже того же
 * дня вычитается из продаж, часть по продаже другого дня стоит отдельно. Строки возвратов от этого
 * не меняются: возврат по-прежнему стоит одной строкой со всеми своими деньгами зоны.
 */
import type { SaleFigures } from './documents/sale.functions.js';
import type { RefundFigures } from './documents/refund.functions.js';
import { allocate } from './money-shares.js';
import { dayOf } from './policies/closed-period.js';

/** Деньги строки в копейках. `installment` — первоначальный взнос рассрочки, в том числе оплата банком. */
export interface SummaryAmounts {
    readonly cash: number;
    readonly cashless: number;
    readonly installment: number;
}

/**
 * Связанный документ в раскрытой строке. У продажи это её возвраты и взносы за период, у возврата —
 * его продажи. У взноса `guid` указывает на рассрочку, а `number` пуст: взнос не документ.
 */
export interface SummaryLink {
    readonly kind: 'sale' | 'refund' | 'payment';
    readonly guid: string;
    readonly number: string | null;
    readonly date: string;
}

/** Строка продажи или возврата в одной зоне 1С: товары этой зоны и их доля денег. */
export interface SummaryOperation {
    readonly key: string;
    readonly kind: 'sale' | 'refund';
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly goods: ReadonlyArray<{ readonly name: string; readonly code: string | null; readonly size: string | null }>;
    readonly amounts: SummaryAmounts;
    readonly links: ReadonlyArray<SummaryLink>;
}

/** Взнос, показанный в таблице «Взносы»: по нему продажа получает ссылку в раскрытой строке. */
export interface SummaryPaymentLink {
    readonly sale: string;
    readonly installment: string;
    readonly date: string;
}

/** Деньги возвратов: возврат выдаёт только наличные и безналичные, рассрочку он не возвращает деньгами. */
export interface SummaryRefundAmounts {
    readonly cash: number;
    readonly cashless: number;
}

/**
 * Итоги зоны или всей сводки.
 *
 * - `sales` — деньги продаж и взносов за вычетом возвратов в день продажи (строка «Продажи»).
 * - `refunds` — возвраты по продажам других дней, со знаком минус (строка «Возвраты»).
 * - `all` — сумма обоих слагаемых: все деньги с учётом всех возвратов.
 */
export interface SummaryTotals {
    readonly sales: SummaryAmounts;
    readonly refunds: SummaryRefundAmounts;
    readonly all: SummaryAmounts;
}

/** Складывает итоги: каждое слагаемое отдельно. */
export const addSummaryTotals = (first: SummaryTotals, second: SummaryTotals): SummaryTotals => ({
    sales: addSummaryAmounts(first.sales, second.sales),
    refunds: { cash: first.refunds.cash + second.refunds.cash, cashless: first.refunds.cashless + second.refunds.cashless },
    all: addSummaryAmounts(first.all, second.all),
});

/** Итоги из денег продаж и возвратов других дней; полная сумма считается из них. */
export const summaryTotals = (sales: SummaryAmounts, refunds: SummaryRefundAmounts): SummaryTotals => ({
    sales, refunds, all: addSummaryAmounts(sales, { ...refunds, installment: 0 }),
});

export const emptySummaryAmounts = (): SummaryAmounts => ({ cash: 0, cashless: 0, installment: 0 });
export const addSummaryAmounts = (first: SummaryAmounts, second: SummaryAmounts): SummaryAmounts => ({
    cash: first.cash + second.cash, cashless: first.cashless + second.cashless, installment: first.installment + second.installment,
});

/** Порядок строк: по моменту, затем по номеру. Даты хранятся с часовым поясом клиента, поэтому сравниваются моменты. */
const byMoment = (first: { readonly date: string; readonly number: string | null }, second: { readonly date: string; readonly number: string | null }) =>
    new Date(first.date).getTime() - new Date(second.date).getTime() || (first.number ?? '').localeCompare(second.number ?? '');

/**
 * Строит две зоны 1С. Смешанная продажа и возврат имеют строку в каждой зоне со своими товарами
 * и долями денег.
 *
 * - `sales` — продажи периода и продажи-основания его возвратов; строку получают только продажи
 *   с днём в периоде (`from` и позже).
 * - `refunds` — возвраты периода. Возврат по нескольким продажам даёт одну строку в зоне.
 * - `initial` — первоначальные взносы продаж периода, внесённые в периоде. Они делятся между товарами
 *   по долям оплаты «Рассрочка», как оплаты продажи.
 * - `payments` — взносы таблицы «Взносы»: они дают ссылки в раскрытой строке своей продажи.
 */
export function summaryOperations(sales: ReadonlyArray<SaleFigures>, refunds: ReadonlyArray<RefundFigures>, from: string,
    initial: ReadonlyMap<string, number>, payments: ReadonlyArray<SummaryPaymentLink>) {
    const periodRefunds = new Set(refunds.map((refund) => refund.refund));
    const build = (posted: boolean) => {
        const rows: SummaryOperation[] = [];
        // Возвраты по продажам других дней копятся отдельно от строк: строка возврата показывает
        // все его деньги зоны, а итог делит их по дням продаж.
        const otherDayRefunds = { cash: 0, cashless: 0 };
        let sameDayRefunds = emptySummaryAmounts();
        for (const sale of sales) {
            if (sale.date.slice(0, 10) < from) continue;
            const zone = sale.goods.map((line) => line.postedIn1C === posted);
            if (!zone.some(Boolean)) continue;
            // Первоначальный взнос делится по исходным долям оплаты «Рассрочка» всех товаров продажи,
            // чтобы сумма зон давала ровно взнос.
            const initialShares = allocate(initial.get(sale.sale) ?? 0, sale.goods.map((line) => line.payments.installment));
            const amounts = sale.goods.reduce((sum, line, index) => zone[index] ? addSummaryAmounts(sum, {
                cash: line.payments.cash, cashless: line.payments.cashless, installment: initialShares[index]!,
            }) : sum, emptySummaryAmounts());
            const links: SummaryLink[] = [
                ...sale.refunds.filter((item) => periodRefunds.has(item.refund)).map((item): SummaryLink => ({
                    kind: 'refund', guid: item.refund, number: refunds.find((refund) => refund.refund === item.refund)?.number ?? null, date: item.date,
                })),
                ...payments.filter((payment) => payment.sale === sale.sale).map((payment): SummaryLink => ({ kind: 'payment', guid: payment.installment, number: null, date: payment.date })),
            ].sort(byMoment);
            rows.push({
                key: `sale-${sale.sale}-${posted}`, kind: 'sale', guid: sale.sale, number: sale.number, date: sale.date,
                goods: sale.goods.filter((_, index) => zone[index]), amounts, links,
            });
        }
        for (const refund of refunds) {
            // Доли возврата по товарам каждой продажи-основания; в строку зоны входят только товары зоны.
            const parts = sales.flatMap((sale) => {
                const shares = sale.refunds.find((item) => item.refund === refund.refund)?.goods ?? [];
                const selected = shares.filter((share) => share.amount > 0 && sale.goods.some((line) => line.lineNumber === share.lineNumber && line.postedIn1C === posted));
                return selected.length === 0 ? [] : [{ sale, selected }];
            });
            if (parts.length === 0) continue;
            // Списание долга «В счёт долга» денег не выдаёт, поэтому в строку возврата не входит.
            const partSum = (part: typeof parts[number], field: 'cash' | 'cashless') => part.selected.reduce((subtotal, line) => subtotal + line[field], 0);
            const sum = (field: 'cash' | 'cashless') => -parts.reduce((total, part) => total + partSum(part, field), 0);
            // День продажи и день возврата сравниваются по дню документа, как остальные правила сводки.
            // Продажа прошлого периода всегда другого дня.
            for (const part of parts) {
                if (dayOf(part.sale.date) === dayOf(refund.date)) {
                    sameDayRefunds = addSummaryAmounts(sameDayRefunds, { cash: -partSum(part, 'cash'), cashless: -partSum(part, 'cashless'), installment: 0 });
                } else {
                    otherDayRefunds.cash -= partSum(part, 'cash');
                    otherDayRefunds.cashless -= partSum(part, 'cashless');
                }
            }
            rows.push({
                key: `refund-${refund.refund}-${posted}`, kind: 'refund', guid: refund.refund, number: refund.number, date: refund.date,
                goods: parts.flatMap((part) => part.sale.goods.filter((line) => part.selected.some((share) => share.lineNumber === line.lineNumber))),
                amounts: { cash: sum('cash'), cashless: sum('cashless'), installment: 0 },
                links: parts.map((part): SummaryLink => ({ kind: 'sale', guid: part.sale.sale, number: part.sale.number, date: part.sale.date })),
            });
        }
        rows.sort(byMoment);
        const salesAmounts = rows.filter((row) => row.kind === 'sale').reduce((sum, row) => addSummaryAmounts(sum, row.amounts), sameDayRefunds);
        return { rows, totals: summaryTotals(salesAmounts, otherDayRefunds) };
    };
    const postedZone = build(true);
    const notPostedZone = build(false);
    return { posted: postedZone, notPosted: notPostedZone, totals: addSummaryTotals(postedZone.totals, notPostedZone.totals) };
}
