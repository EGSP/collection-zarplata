/** Строки и денежные итоги продаж и возвратов для вкладок «Период» и «Касса». */
import type { SaleFigures } from './documents/sale.functions.js';
import type { RefundFigures } from './documents/refund.functions.js';
import { allocate } from './money-shares.js';
import { dayOf } from './policies/closed-period.js';
import { mergeBreakdowns, splitBreakdown, type BreakdownColumns, type SummaryBreakdown } from './summary-breakdown.js';

/**
 * Деньги строки в копейках. В сводке за период `installment` содержит банковскую оплату,
 * а первоначальный взнос по собственной рассрочке входит в свой способ оплаты. В кассовой сводке — оплата банком и остаток собственной рассрочки
 * за вычетом первоначального взноса; у возврата — погашение долга со знаком минус.
 */
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

/** Строка продажи или возврата с товарами и денежными суммами. */
export interface SummaryOperation {
    readonly key: string;
    readonly kind: 'sale' | 'refund';
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly goods: ReadonlyArray<{ readonly name: string; readonly code: string | null; readonly size: string | null }>;
    readonly amounts: SummaryAmounts;
    readonly links: ReadonlyArray<SummaryLink>;
    /** Старые снимки кассовой сверки могли сохраняться без расшифровки. */
    readonly breakdown?: SummaryBreakdown;
}

/** Взнос, показанный в таблице «Взносы»: по нему продажа получает ссылку в раскрытой строке. */
export interface SummaryPaymentLink {
    readonly sale: string;
    readonly installment: string;
    readonly date: string;
}

/** Итоги продаж, возвратов и их сумма. Касса вычитает возврат в день продажи из продаж. */
export interface SummaryTotals {
    readonly sales: SummaryAmounts;
    readonly refunds: SummaryAmounts;
    readonly all: SummaryAmounts;
    readonly breakdown?: Readonly<Record<'sales' | 'refunds' | 'all', SummaryBreakdown>>;
}

/** Складывает итоги: каждое слагаемое отдельно. */
export function addSummaryTotals(first: SummaryTotals, second: SummaryTotals): SummaryTotals {
    const totals = {
        sales: addSummaryAmounts(first.sales, second.sales),
        refunds: addSummaryAmounts(first.refunds, second.refunds),
        all: addSummaryAmounts(first.all, second.all),
    };
    if (first.breakdown === undefined || second.breakdown === undefined) return totals;
    return withBreakdown(totals, mergeBreakdowns([first.breakdown.sales, second.breakdown.sales]),
        mergeBreakdowns([first.breakdown.refunds, second.breakdown.refunds]));
}

/** Общий итог объединяет поступления и выдачи со знаком минус по тем же приёмникам. */
export function withBreakdown(totals: SummaryTotals, sales: SummaryBreakdown, refunds: SummaryBreakdown): SummaryTotals {
    return { ...totals, breakdown: { sales, refunds, all: mergeBreakdowns([sales, refunds]) } };
}

/** Складывает суммы продаж и возвратов в общий итог. */
export const summaryTotals = (sales: SummaryAmounts, refunds: SummaryAmounts): SummaryTotals => ({
    sales, refunds, all: addSummaryAmounts(sales, refunds),
});

/** Пустые суммы по трём денежным колонкам. */
export const emptySummaryAmounts = (): SummaryAmounts => ({ cash: 0, cashless: 0, installment: 0 });
/** Складывает суммы по каждой колонке. */
export const addSummaryAmounts = (first: SummaryAmounts, second: SummaryAmounts): SummaryAmounts => ({
    cash: first.cash + second.cash, cashless: first.cashless + second.cashless, installment: first.installment + second.installment,
});

/** Порядок строк: по моменту, затем по номеру. Даты хранятся с часовым поясом клиента, поэтому сравниваются моменты. */
const byMoment = (first: { readonly date: string; readonly number: string | null }, second: { readonly date: string; readonly number: string | null }) =>
    new Date(first.date).getTime() - new Date(second.date).getTime() || (first.number ?? '').localeCompare(second.number ?? '');

/** Исходные оплаты и выдачи обеих сводок до распределения по товарам. Выдачи здесь положительные. */
export interface SummaryBreakdownSources {
    readonly sale: (sale: string) => BreakdownColumns;
    readonly installment: (sale: string) => BreakdownColumns;
    readonly refund: (refund: string, sale: string) => BreakdownColumns;
}

/** Данные проведённых документов и денежные позиции, из которых обе сводки собирают строки. */
interface SummaryOperationsInput {
    readonly sales: ReadonlyArray<SaleFigures>;
    readonly refunds: ReadonlyArray<RefundFigures>;
    readonly from: string;
    readonly initial: ReadonlyMap<string, SummaryAmounts>;
    readonly payments: ReadonlyArray<SummaryPaymentLink>;
    readonly sources: SummaryBreakdownSources;
}

/** Строит две зоны 1С для сверки кассового дня. */
export function summaryOperations(input: SummaryOperationsInput) {
    const posted = buildOperations(input, 'posted');
    const notPosted = buildOperations(input, 'notPosted');
    return { posted, notPosted, totals: addSummaryTotals(posted.totals, notPosted.totals) };
}

/** Строит единый список документов и все денежные возвраты за выбранные даты. */
export function periodOperations(input: SummaryOperationsInput) {
    return buildOperations(input, 'period');
}

/** Собирает строки, сохраняя суммы документов и расшифровок до копейки. */
function buildOperations({ sales, refunds, from, initial, payments, sources }: SummaryOperationsInput,
    mode: 'period' | 'posted' | 'notPosted') {
    const cashReport = mode !== 'period';
    // У кассовой сводки ключи входят в отпечаток снимка сверки.
    const rowKeySuffix = cashReport ? String(mode === 'posted') : mode;
    const periodRefunds = new Set(refunds.map((refund) => refund.refund));
    /** Касса отбирает товары одной зоны, в период входят все товары. */
    const includesGoods = (postedIn1C: boolean) => !cashReport || postedIn1C === (mode === 'posted');
    const rows: SummaryOperation[] = [];
    // Только касса вычитает возврат по продаже того же дня из продаж.
    let separateRefunds = emptySummaryAmounts();
    let sameDayRefunds = emptySummaryAmounts();
    const salesBreakdowns: BreakdownColumns[] = [];
    const refundBreakdowns: BreakdownColumns[] = [];
    for (const sale of sales) {
        if (sale.date.slice(0, 10) < from) continue;
        const zone = sale.goods.map((line) => includesGoods(line.postedIn1C));
        if (!zone.some(Boolean)) continue;
        // Деньги рассрочки делятся по исходным долям оплаты «Рассрочка» всех товаров продажи,
        // каждая колонка отдельно, чтобы сумма зон давала ровно каждую колонку.
        const weights = sale.goods.map((line) => line.payments.installment);
        const ofSale = initial.get(sale.sale) ?? emptySummaryAmounts();
        const initialCash = allocate(ofSale.cash, weights);
        const initialCashless = allocate(ofSale.cashless, weights);
        const initialInstallment = allocate(ofSale.installment, weights);
        const amounts = sale.goods.reduce((sum, line, index) => zone[index] ? addSummaryAmounts(sum, {
            cash: line.payments.cash + initialCash[index]!, cashless: line.payments.cashless + initialCashless[index]!, installment: initialInstallment[index]!,
        }) : sum, emptySummaryAmounts());
        const links: SummaryLink[] = [
            ...sale.refunds.filter((item) => periodRefunds.has(item.refund)).map((item): SummaryLink => ({
                kind: 'refund', guid: item.refund, number: refunds.find((refund) => refund.refund === item.refund)?.number ?? null, date: item.date,
            })),
            ...payments.filter((payment) => payment.sale === sale.sale).map((payment): SummaryLink => ({ kind: 'payment', guid: payment.installment, number: null, date: payment.date })),
        ].sort(byMoment);

        const paid = sources.sale(sale.sale);
        const advance = sources.installment(sale.sale);
        const breakdown = mergeBreakdowns([{
            cash: splitBreakdown(paid.cash, sale.goods.map((line) => line.payments.cash), zone),
            cashless: splitBreakdown(paid.cashless, sale.goods.map((line) => line.payments.cashless), zone),
            installment: [],
        }, {
            cash: splitBreakdown(advance.cash, initialCash, zone),
            cashless: splitBreakdown(advance.cashless, initialCashless, zone),
            installment: splitBreakdown(advance.installment, initialInstallment, zone),
        }]);
        salesBreakdowns.push(breakdown);
        rows.push({
            key: `sale-${sale.sale}-${rowKeySuffix}`, kind: 'sale', guid: sale.sale, number: sale.number, date: sale.date,
            goods: sale.goods.filter((_, index) => zone[index]), amounts, links,
            breakdown,
        });
    }
    for (const refund of refunds) {
        // Доли возврата по товарам каждой продажи-основания; в строку зоны входят только товары зоны.
        const parts = sales.flatMap((sale) => {
            const shares = sale.refunds.find((item) => item.refund === refund.refund)?.goods ?? [];
            const selected = shares.filter((share) => share.amount > 0 && sale.goods.some((line) => line.lineNumber === share.lineNumber && includesGoods(line.postedIn1C)));
            return selected.length === 0 ? [] : [{ sale, shares, selected }];
        });
        if (parts.length === 0) continue;
        // Списание долга «В счёт долга» денег не выдаёт, поэтому в сводке за период в строку возврата
        // не входит; кассовая сводка ставит его в «Рассрочку» (`cashReport`).
        const partSum = (part: typeof parts[number], field: 'cash' | 'cashless' | 'debt') => part.selected.reduce((subtotal, line) => subtotal + line[field], 0);
        const partAmounts = (part: typeof parts[number]): SummaryAmounts => ({
            cash: -partSum(part, 'cash'), cashless: -partSum(part, 'cashless'), installment: cashReport ? -partSum(part, 'debt') : 0,
        });
        // Сравнение дат нужно для кассовой сверки. В периоде любая выдача входит в возвраты.
        const rowBreakdowns: BreakdownColumns[] = [];
        for (const part of parts) {
            const sameDay = cashReport && dayOf(part.sale.date) === dayOf(refund.date);
            if (sameDay) sameDayRefunds = addSummaryAmounts(sameDayRefunds, partAmounts(part));
            else separateRefunds = addSummaryAmounts(separateRefunds, partAmounts(part));
            const received = sources.refund(refund.refund, part.sale.sale);
            const zone = part.shares.map((share) => part.selected.includes(share));
            const breakdown = {
                cash: splitBreakdown(received.cash, part.shares.map((share) => share.cash), zone, -1),
                cashless: splitBreakdown(received.cashless, part.shares.map((share) => share.cashless), zone, -1),
                installment: cashReport ? splitBreakdown(received.installment, part.shares.map((share) => share.debt), zone, -1) : [],
            };
            rowBreakdowns.push(breakdown);
            (sameDay ? salesBreakdowns : refundBreakdowns).push(breakdown);
        }
        rows.push({
            key: `refund-${refund.refund}-${rowKeySuffix}`, kind: 'refund', guid: refund.refund, number: refund.number, date: refund.date,
            goods: parts.flatMap((part) => part.sale.goods.filter((line) => part.selected.some((share) => share.lineNumber === line.lineNumber))),
            amounts: parts.map(partAmounts).reduce(addSummaryAmounts, emptySummaryAmounts()),
            links: parts.map((part): SummaryLink => ({ kind: 'sale', guid: part.sale.sale, number: part.sale.number, date: part.sale.date })),
            breakdown: mergeBreakdowns(rowBreakdowns),
        });
    }
    rows.sort(byMoment);
    const salesAmounts = rows.filter((row) => row.kind === 'sale').reduce((sum, row) => addSummaryAmounts(sum, row.amounts), sameDayRefunds);
    const totals = summaryTotals(salesAmounts, separateRefunds);
    return { rows, totals: withBreakdown(totals, mergeBreakdowns(salesBreakdowns), mergeBreakdowns(refundBreakdowns)) };
}
