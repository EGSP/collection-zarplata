/**
 * Пакетный расчёт продаж: исходные суммы, возвраты и остаток по товарам на конец дня.
 * Описания читаются из Metadata: импорт документов сюда замкнул бы продажу с возвратом
 * и рассрочкой. Файл функций остаётся доступным для всех потребителей без круга импортов.
 */
import { Effect } from 'effect';
import { callFunction } from '../../server/data/action-context.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { Metadata, type FunctionBuilder, type SignatureOf } from '../../server/metadata/index.js';
import { allocate } from '../money-shares.js';
import { cash, installmentMethod, paymentMethods } from '../payments.js';
import { dayOf } from '../policies/closed-period.js';
import { SaleInstallmentFunctions } from './sale-installment.functions.js';

/** Суммы в копейках, раздельно по трём способам оплаты продажи. */
export interface SalePaymentTotals {
    readonly cash: number;
    readonly cashless: number;
    readonly installment: number;
}

/** Товар продажи и его суммы до и после проведённых возвратов. */
export interface SaleGoodsFigures {
    readonly lineNumber: number;
    readonly name: string;
    readonly code: string | null;
    readonly size: string | null;
    readonly postedIn1C: boolean;
    readonly total: number;
    readonly refunded: number;
    readonly netTotal: number;
    readonly payments: SalePaymentTotals;
    readonly netPayments: SalePaymentTotals;
    readonly installmentPaid: number;
    readonly installmentOpen: boolean;
}

/** Сведения о продаже. Отсутствующие, удалённые и непроведённые продажи в ответ не входят. */
export interface SaleFigures {
    readonly sale: string;
    readonly date: string;
    readonly amount: number;
    readonly refunded: number;
    readonly netAmount: number;
    readonly payments: SalePaymentTotals;
    readonly netPayments: SalePaymentTotals;
    readonly refunds: ReadonlyArray<{ readonly refund: string; readonly date: string; readonly amount: number }>;
    readonly installment: { readonly amount: number; readonly paid: number; readonly refunded: number; readonly debt: number; readonly unarranged: number; readonly open: boolean };
    readonly goods: ReadonlyArray<SaleGoodsFigures>;
}

const active = [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }] as const;
const emptyPayments = (): SalePaymentTotals => ({ cash: 0, cashless: 0, installment: 0 });
const sumPayments = (rows: ReadonlyArray<SalePaymentTotals>): SalePaymentTotals => rows.reduce((sum, row) => ({
    cash: sum.cash + row.cash, cashless: sum.cashless + row.cashless, installment: sum.installment + row.installment,
}), emptyPayments());
const nullableText = (value: unknown): string | null => value === null || value === undefined ? null : String(value);

/** Такой же ключ товара использует подбор возврата. Повторяющиеся строки сопоставляются по порядку. */
const goodsKey = (line: Readonly<Record<string, unknown>>) => JSON.stringify([
    line['name'], line['code'] ?? null, line['size'] ?? null, line['comment'] ?? null, line['cost'], line['discount'] ?? null,
]);

/** Число запросов зависит от видов данных, а не от числа продаж; пустой пакет не читает таблицы. */
const saleFigures = Effect.fn('sale.figures')(function* (sales: ReadonlyArray<string>, date: string | null) {
    const guids = [...new Set(sales)];
    if (guids.length === 0) return [] as SaleFigures[];
    const database = yield* ReadonlyDatabase;
    const metadata = yield* Metadata;
    const description = (name: string) => {
        const found = metadata.find('document', name);
        if (found === undefined) throw new Error(`В конфигурации нет документа ${name}`);
        return found;
    };
    const sale = description('sale');
    const refund = description('refund');
    const installment = description('saleInstallment');
    const through = (value: unknown) => date === null || dayOf(String(value)) <= date;
    const headers = (yield* database.all(query(sale).select({
        columns: ['guid', 'date', 'amount'], where: [...active, { column: 'guid', operator: 'IN', value: guids }],
    }))).filter((row) => through(row['date']));
    if (headers.length === 0) return [] as SaleFigures[];
    const owners = headers.map((row) => String(row['guid']));
    const goods = yield* database.all(query(sale).tablePart('goods').select({
        columns: ['ownerGuid', 'lineNumber', 'name', 'code', 'size', 'comment', 'cost', 'discount', 'total', 'postedIn1C'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: owners }], orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
    }));
    const payments = yield* database.all(query(sale).tablePart('payments').select({
        columns: ['ownerGuid', 'method', 'amount'], where: [{ column: 'ownerGuid', operator: 'IN', value: owners }],
    }));
    const returned = yield* database.all(query(refund).tablePart('goods').select({
        columns: ['ownerGuid', 'lineNumber', 'sale', 'name', 'code', 'size', 'comment', 'cost', 'discount', 'total'],
        where: [{ column: 'sale', operator: 'IN', value: owners }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const refundHeaders = returned.length === 0 ? [] : (yield* database.all(query(refund).select({
        columns: ['guid', 'date'], where: [...active, { column: 'guid', operator: 'IN', value: [...new Set(returned.map((row) => String(row['ownerGuid'])))] }],
    }))).filter((row) => through(row['date']));
    const refundDates = new Map(refundHeaders.map((row) => [String(row['guid']), String(row['date'])]));
    const installments = (yield* database.all(query(installment).select({
        columns: ['guid', 'sale', 'date', 'amount'], where: [...active, { column: 'sale', operator: 'IN', value: owners }],
    }))).filter((row) => through(row['date']));
    const figures = new Map((yield* callFunction(SaleInstallmentFunctions, 'figures', {
        date, installments: installments.map((row) => ({ guid: String(row['guid']) })),
    })).map((row) => [row.installment, row]));
    const result = new Map<string, SaleFigures>();
    for (const header of headers) {
        const guid = String(header['guid']);
        const lines = goods.filter((row) => row['ownerGuid'] === guid);
        const totals = lines.map((row) => Number(row['total']));
        const returnedByLine = totals.map(() => 0);
        const refunds = new Map<string, number>();
        let unmatched = 0;
        for (const line of returned.filter((row) => row['sale'] === guid && refundDates.has(String(row['ownerGuid'])))) {
            const owner = String(line['ownerGuid']);
            const amount = Number(line['total']);
            refunds.set(owner, (refunds.get(owner) ?? 0) + amount);
            const index = lines.findIndex((original, index) => goodsKey(original) === goodsKey(line) && returnedByLine[index]! < totals[index]!);
            if (index < 0) unmatched += amount;
            else {
                const matched = Math.min(amount, totals[index]! - returnedByLine[index]!);
                returnedByLine[index]! += matched;
                unmatched += amount - matched;
            }
        }
        // Старые возвраты могут содержать исправленные реквизиты товара. Их сумму нельзя потерять:
        // несопоставленный остаток делится по стоимости ещё не возвращённых товаров.
        const unmatchedShares = allocate(unmatched, totals.map((total, index) => total - returnedByLine[index]!));
        const refundedShares = returnedByLine.map((amount, index) => amount + unmatchedShares[index]!);
        const cashless = paymentMethods.find((method) => method !== cash)!;
        // Способы распределяются последовательно по оставшейся стоимости товара. Независимое
        // округление каждого способа могло бы дать товару стоимостью 1 копейку две копейки оплат,
        // а после полного возврата оставить в сводке лишнюю копейку.
        let remaining = [...totals];
        const shares = [cash, cashless, installmentMethod].map((method) => {
            const amount = payments.filter((row) => row['ownerGuid'] === guid && row['method'] === method).reduce((sum, row) => sum + Number(row['amount']), 0);
            const allocated = allocate(amount, remaining);
            remaining = remaining.map((total, index) => total - allocated[index]!);
            return allocated;
        });
        const originalPayments = totals.map((_, index): SalePaymentTotals => ({ cash: shares[0]![index]!, cashless: shares[1]![index]!, installment: shares[2]![index]! }));
        const netPayments = originalPayments.map((payment, index): SalePaymentTotals => {
            const deducted = allocate(refundedShares[index]!, [payment.cash, payment.cashless, payment.installment]);
            return { cash: payment.cash - deducted[0]!, cashless: payment.cashless - deducted[1]!, installment: payment.installment - deducted[2]! };
        });
        const ownInstallments = installments.filter((row) => row['sale'] === guid);
        const ownFigures = ownInstallments.map((row) => figures.get(String(row['guid']))!);
        const sum = (field: 'amount' | 'paid' | 'refunded' | 'debt') => ownFigures.reduce((total, row) => total + row[field], 0);
        const installmentTotal = originalPayments.reduce((total, payment) => total + payment.installment, 0);
        const unarranged = Math.max(0, installmentTotal - ownInstallments.reduce((total, row) => total + Number(row['amount']), 0));
        const open = installmentTotal > 0 && (unarranged > 0 || ownFigures.some((row) => row.debt > 0));
        const netInstallments = netPayments.map((row) => row.installment);
        const paidShares = allocate(Math.min(sum('paid'), netInstallments.reduce((total, amount) => total + amount, 0)), netInstallments);
        const refunded = [...refunds.values()].reduce((total, amount) => total + amount, 0);
        result.set(guid, {
            sale: guid, date: String(header['date']), amount: Number(header['amount']), refunded, netAmount: Number(header['amount']) - refunded,
            payments: sumPayments(originalPayments), netPayments: sumPayments(netPayments),
            refunds: [...refunds].map(([refund, amount]) => ({ refund, date: refundDates.get(refund)!, amount })),
            installment: { amount: sum('amount'), paid: sum('paid'), refunded: sum('refunded'), debt: sum('debt'), unarranged, open },
            goods: lines.map((line, index): SaleGoodsFigures => ({
                lineNumber: Number(line['lineNumber']), name: String(line['name']), code: nullableText(line['code']), size: nullableText(line['size']), postedIn1C: line['postedIn1C'] === true,
                total: totals[index]!, refunded: refundedShares[index]!, netTotal: totals[index]! - refundedShares[index]!,
                payments: originalPayments[index]!, netPayments: netPayments[index]!, installmentPaid: paidShares[index]!, installmentOpen: open && netInstallments[index]! > 0,
            })),
        });
    }
    return guids.flatMap((guid) => result.has(guid) ? [result.get(guid)!] : []);
});

/** Функция документа `figures`: продажи на текущий момент или по конец указанного дня. */
export const figuresFunction = (builder: FunctionBuilder) => builder
    .title('Сведения о продажах')
    .input((input) => input
        .field('date', (field) => field.date().title('На день'))
        .tablePart('sales', (part) => part.title('Продажи').field('guid', (field) => field.string().title('Продажа').required())))
    .handle((input) => saleFigures(input.sales.map((row) => row.guid), input.date ?? null));

/** Нейтральная ссылка позволяет вызывать функцию, не импортируя документ продажи. */
export type SaleFunctions = { readonly figures: SignatureOf<ReturnType<typeof figuresFunction>> };
const saleTarget = { kind: 'document', name: 'sale' } as const;
export const SaleFunctions = saleTarget as typeof saleTarget & { readonly '~functions': SaleFunctions };
