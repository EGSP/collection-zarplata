/** Связанные строки сводки: продажа до возвратов, возвраты отдельными вычетами, старая продажа только как основание. */
import type { SaleFigures } from './documents/sale.functions.js';
import type { RefundFigures } from './documents/refund.functions.js';

export interface SummaryAmounts {
    readonly cash: number;
    readonly cashless: number;
    readonly bank: number;
    readonly advance: number;
    /** Полная собственная рассрочка без вычета взносов; списание учитывается только для продажи того же периода. */
    readonly own: number;
    readonly debt: number;
}

export interface SummaryOperation {
    readonly key: string;
    readonly kind: 'sale' | 'refund';
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly goods: ReadonlyArray<{ readonly name: string; readonly code: string | null; readonly size: string | null }>;
    readonly amounts: SummaryAmounts;
    /** Продажа другого периода дана только для связи, без чисел в денежных колонках. */
    readonly context: boolean;
    readonly children: ReadonlyArray<SummaryOperation>;
}

export const emptySummaryAmounts = (): SummaryAmounts => ({ cash: 0, cashless: 0, bank: 0, advance: 0, own: 0, debt: 0 });
export const addSummaryAmounts = (first: SummaryAmounts, second: SummaryAmounts): SummaryAmounts => ({
    cash: first.cash + second.cash, cashless: first.cashless + second.cashless,
    bank: first.bank + second.bank, advance: first.advance + second.advance, own: first.own + second.own, debt: first.debt + second.debt,
});

/** Сохраняет две зоны 1С. Смешанная продажа имеет строку в каждой зоне со своей частью товаров и сумм. */
export function summaryOperations(sales: ReadonlyArray<SaleFigures>, refunds: ReadonlyArray<RefundFigures>, from: string) {
    const build = (posted: boolean) => {
        const rows: SummaryOperation[] = [];
        const saleRow = (sale: SaleFigures, context: boolean): SummaryOperation => {
            const goods = sale.goods.filter((line) => line.postedIn1C === posted);
            return {
                key: `sale-${sale.sale}-${posted}`, kind: 'sale', guid: sale.sale, number: sale.number, date: sale.date, goods, context,
                // Возвраты периода будут отдельными денежными строками. Возвращаем их доли
                // в числа родительской продажи, чтобы пользователь видел оба слагаемых.
                amounts: goods.reduce((sum, line) => {
                    const returned = sale.refunds.filter((item) => refunds.some((refund) => refund.refund === item.refund))
                        .flatMap((item) => item.goods.filter((item) => item.lineNumber === line.lineNumber));
                    return addSummaryAmounts(sum, {
                        cash: line.actualCash + returned.reduce((total, item) => total + item.cash, 0),
                        cashless: line.actualCashless + returned.reduce((total, item) => total + item.cashless, 0),
                        bank: line.bankPaid, advance: line.advancePaid, own: line.ownAmount,
                        debt: line.debt + returned.reduce((total, item) => total + item.debt, 0),
                    });
                }, emptySummaryAmounts()), children: [],
            };
        };
        // Возврат может относиться к нескольким продажам: в каждой связи показывается только её часть.
        const refundRow = (refund: RefundFigures, sale: SaleFigures): SummaryOperation | null => {
            const shares = sale.refunds.find((row) => row.refund === refund.refund)?.goods ?? [];
            const selected = shares.filter((share) => sale.goods.some((line) => line.lineNumber === share.lineNumber && line.postedIn1C === posted));
            if (!selected.some((line) => line.amount > 0)) return null;
            const sum = (field: 'cash' | 'cashless' | 'debt') => -selected.reduce((total, line) => total + line[field], 0);
            // Списание старого долга не уменьшает новые рассрочки периода. Истинный долг
            // сохраняется в figures и таблице должников; здесь меняется только показ сводки.
            const debt = sale.date.slice(0, 10) >= from ? sum('debt') : 0;
            return {
                key: `refund-${refund.refund}-${sale.sale}-${posted}`, kind: 'refund', guid: refund.refund, number: refund.number, date: refund.date,
                goods: sale.goods.filter((line) => selected.some((share) => share.lineNumber === line.lineNumber && share.amount > 0)),
                amounts: { cash: sum('cash'), cashless: sum('cashless'), debt, own: debt, bank: 0, advance: 0 },
                context: false, children: [],
            };
        };
        for (const sale of sales) {
            const own = saleRow(sale, false);
            const related = refunds.flatMap((refund) => { const row = refundRow(refund, sale); return row === null ? [] : [row]; });
            if (sale.date.slice(0, 10) >= from) {
                if (own.goods.length > 0) rows.push({ ...own, children: related });
            } else {
                for (const refund of related) {
                    const existing = rows.findIndex((row) => row.kind === 'refund' && row.guid === refund.guid);
                    const basis = { ...own, key: `${refund.key}-basis`, context: true };
                    if (existing < 0) rows.push({ ...refund, children: [basis] });
                    else {
                        const previous = rows[existing]!;
                        rows[existing] = { ...previous, goods: [...previous.goods, ...refund.goods], amounts: addSummaryAmounts(previous.amounts, refund.amounts), children: [...previous.children, basis] };
                    }
                }
            }
        }
        rows.sort((first, second) => first.date.localeCompare(second.date) || first.number.localeCompare(second.number) || first.key.localeCompare(second.key));
        // У продажи считаются и родительская строка, и её возвраты. У отдельного возврата
        // подчинённая старая продажа контекстная и в итог не входит.
        const totalOf = (row: SummaryOperation): SummaryAmounts => row.context ? emptySummaryAmounts()
            : row.children.reduce((sum, child) => addSummaryAmounts(sum, child.context ? emptySummaryAmounts() : child.amounts), row.amounts);
        return { rows, totals: rows.reduce((sum, row) => addSummaryAmounts(sum, totalOf(row)), emptySummaryAmounts()) };
    };
    const posted = build(true);
    const notPosted = build(false);
    return { posted, notPosted, totals: addSummaryAmounts(posted.totals, notPosted.totals) };
}
