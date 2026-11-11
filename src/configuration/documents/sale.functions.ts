/**
 * Пакетный расчёт продаж: исходные суммы, возвраты и остаток по товарам на конец дня.
 * Описания читаются из Metadata: импорт документов сюда замкнул бы продажу с возвратом
 * и рассрочкой. Файл функций остаётся доступным для всех потребителей без круга импортов.
 */
import { DataValidationError } from '../../server/data/data.errors.js';
import { Effect } from 'effect';
import { callFunction } from '../../server/data/action-context.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { Metadata, type FunctionBuilder, type SignatureOf } from '../../server/metadata/index.js';
import { refundGoodsWeights } from '../refund-goods-shares.js';
import { allocate } from '../money-shares.js';
import { cash, installmentMethod, paymentMethods } from '../payments.js';
import { dayOf } from '../policies/closed-period.js';
import { readRefundFigures } from './refund.functions.js';
import { SaleInstallmentFunctions } from './sale-installment.functions.js';

/** Суммы в копейках, раздельно по трём способам оплаты продажи. */
export interface SalePaymentTotals {
    readonly cash: number;
    readonly cashless: number;
    readonly installment: number;
    /** Оплата сертификатами: для сводки она не деньги, для зарплаты входит в денежную часть. */
    readonly certificate: number;
}

/** Товар продажи и его суммы до и после проведённых возвратов. */
export interface SaleGoodsFigures {
    readonly lineNumber: number;
    readonly name: string;
    readonly code: string | null;
    readonly size: string | null;
    readonly postedIn1C: boolean;
    readonly comment: string | null;
    readonly cost: number;
    readonly discount: number | null;
    /** Процент купона строки; `null` у товара без купона и с денежным купоном. */
    readonly couponPercent: number | null;
    /** Номинал денежного купона строки в копейках; `null` у товара без купона и с процентным купоном. */
    readonly couponDenomination: number | null;
    readonly total: number;
    readonly refunded: number;
    readonly netTotal: number;
    readonly payments: SalePaymentTotals;
    readonly netPayments: SalePaymentTotals;
    readonly installmentPaid: number;
    readonly installmentOpen: boolean;
    /** Фактические денежные выдачи вычитаются по способу расчёта возврата. */
    readonly actualCash: number;
    readonly actualCashless: number;
    readonly bankPaid: number;
    readonly advancePaid: number;
    /** Полная сумма собственной рассрочки: взносы её не уменьшают. */
    readonly ownAmount: number;
    readonly debt: number;
}

/** Сведения о продаже. Отсутствующие, удалённые и непроведённые продажи в ответ не входят. */
export interface SaleFigures {
    readonly sale: string;
    readonly number: string;
    readonly date: string;
    readonly amount: number;
    readonly refunded: number;
    readonly netAmount: number;
    readonly payments: SalePaymentTotals;
    readonly netPayments: SalePaymentTotals;
    readonly refunds: ReadonlyArray<{ readonly refund: string; readonly date: string; readonly amount: number; readonly goods: ReadonlyArray<{ readonly lineNumber: number; readonly amount: number; readonly cash: number; readonly cashless: number; readonly debt: number }> }>;
    readonly installment: { readonly amount: number; readonly paid: number; readonly refunded: number; readonly debt: number; readonly unarranged: number; readonly open: boolean };
    readonly goods: ReadonlyArray<SaleGoodsFigures>;
}

const active = [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }] as const;
const emptyPayments = (): SalePaymentTotals => ({ cash: 0, cashless: 0, installment: 0, certificate: 0 });
const sumPayments = (rows: ReadonlyArray<SalePaymentTotals>): SalePaymentTotals => rows.reduce((sum, row) => ({
    cash: sum.cash + row.cash, cashless: sum.cashless + row.cashless, installment: sum.installment + row.installment, certificate: sum.certificate + row.certificate,
}), emptyPayments());
const nullableText = (value: unknown): string | null => value === null || value === undefined ? null : String(value);

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
        columns: ['guid', 'number', 'date', 'amount'], where: [...active, { column: 'guid', operator: 'IN', value: guids }],
    }))).filter((row) => through(row['date']));
    if (headers.length === 0) return [] as SaleFigures[];
    const owners = headers.map((row) => String(row['guid']));
    const goods = yield* database.all(query(sale).tablePart('goods').select({
        columns: ['ownerGuid', 'lineNumber', 'name', 'code', 'size', 'comment', 'cost', 'discount', 'couponPercent', 'couponDenomination', 'total', 'postedIn1C'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: owners }], orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
    }));
    const payments = yield* database.all(query(sale).tablePart('payments').select({
        columns: ['ownerGuid', 'method', 'amount'], where: [{ column: 'ownerGuid', operator: 'IN', value: owners }],
    }));
    const certificates = yield* database.all(query(sale).tablePart('certificates').select({
        columns: ['ownerGuid', 'amount'], where: [{ column: 'ownerGuid', operator: 'IN', value: owners }],
    }));
    const refundLinks = yield* database.all(query(refund).tablePart('goods').select({
        columns: ['ownerGuid'], where: [{ column: 'sale', operator: 'IN', value: owners }],
    }));
    const refundFigures = yield* readRefundFigures([...new Set(refundLinks.map((row) => String(row['ownerGuid'])))], date);
    const refundDates = new Map(refundFigures.map((row) => [row.refund, row.date]));
    const installments = (yield* database.all(query(installment).select({
        columns: ['guid', 'sale', 'date', 'amount', 'type'], where: [...active, { column: 'sale', operator: 'IN', value: owners }],
    }))).filter((row) => through(row['date']));
    const figures = new Map((yield* callFunction(SaleInstallmentFunctions, 'figures', {
        date, installments: installments.map((row) => ({ guid: String(row['guid']) })),
    })).map((row) => [row.installment, row]));
    const result = new Map<string, SaleFigures>();
    for (const header of headers) {
        const guid = String(header['guid']);
        const lines = goods.filter((row) => row['ownerGuid'] === guid);
        const totals = lines.map((row) => Number(row['total']));
        const refunds = new Map<string, number>();
        const identities = lines.map((line) => ({ name: String(line['name']), code: nullableText(line['code']), size: nullableText(line['size']), comment: nullableText(line['comment']), cost: Number(line['cost']), discount: line['discount'] == null ? null : Number(line['discount']), couponPercent: line['couponPercent'] == null ? null : Number(line['couponPercent']), couponDenomination: line['couponDenomination'] == null ? null : Number(line['couponDenomination']), total: Number(line['total']) }));
        const cashRefunded = totals.map(() => 0);
        const cashlessRefunded = totals.map(() => 0);
        const certificateRefunded = totals.map(() => 0);
        const consumed = totals.map(() => 0);
        const refundShares = new Map<string, Array<{ lineNumber: number; amount: number; cash: number; cashless: number; debt: number }>>();
        // Денежные выдачи относятся к возвращённым товарам продажи; внутри одного возврата
        // доли делятся по стоимости его товаров. Происхождение денег не предполагается.
        for (const refund of [...refundFigures].sort((first, second) => first.date.localeCompare(second.date) || first.number.localeCompare(second.number))) {
            const ownReturned = refund.goods.filter((line) => line.sale === guid);
            if (ownReturned.length === 0) continue;
            refunds.set(refund.refund, ownReturned.reduce((sum, line) => sum + line.total, 0));
            const settlement = refund.settlements.find((row) => row.sale === guid);
            const weights = refundGoodsWeights(identities.map((line, index) => ({ ...line, total: Math.max(0, line.total - consumed[index]!) })), ownReturned);
            const effective = weights.some((value) => value > 0) ? weights : totals;
            const cashParts = allocate(settlement?.cash ?? 0, effective);
            const cashlessParts = allocate(settlement?.cashless ?? 0, effective);
            const debtParts = allocate(settlement?.debt ?? 0, effective);
            const certificateParts = allocate(settlement?.certificate ?? 0, effective);
            refundShares.set(refund.refund, lines.map((line, index) => ({ lineNumber: Number(line['lineNumber']), amount: weights[index]!, cash: cashParts[index]!, cashless: cashlessParts[index]!, debt: debtParts[index]! })));
            for (let index = 0; index < totals.length; index++) {
                consumed[index]! += weights[index]!;
                cashRefunded[index]! += cashParts[index]!;
                cashlessRefunded[index]! += cashlessParts[index]!;
                certificateRefunded[index]! += certificateParts[index]!;
            }
        }
        // Сопоставление стоимости и денежных выдач общее: повторяющиеся товары и старые
        // исправленные реквизиты не должны попадать в разные зоны отчёта.
        const refundedShares = consumed;
        const cashless = paymentMethods.find((method) => method !== cash)!;
        // Способы распределяются последовательно по оставшейся стоимости товара. Независимое
        // округление каждого способа могло бы дать товару стоимостью 1 копейку две копейки оплат,
        // а после полного возврата оставить в сводке лишнюю копейку.
        // Сертификаты распределяются последней частью, как четвёртый способ оплаты.
        let remaining = [...totals];
        const paidBy = (method: string) => payments.filter((row) => row['ownerGuid'] === guid && row['method'] === method).reduce((sum, row) => sum + Number(row['amount']), 0);
        const certificateAmount = certificates.filter((row) => row['ownerGuid'] === guid).reduce((sum, row) => sum + Number(row['amount']), 0);
        const shares = [paidBy(cash), paidBy(cashless), paidBy(installmentMethod), certificateAmount].map((amount) => {
            const allocated = allocate(amount, remaining);
            remaining = remaining.map((total, index) => total - allocated[index]!);
            return allocated;
        });
        const originalPayments = totals.map((_, index): SalePaymentTotals => ({ cash: shares[0]![index]!, cashless: shares[1]![index]!, installment: shares[2]![index]!, certificate: shares[3]![index]! }));
        // Возврат сначала пополняет сертификат (раздел «Правила учёта»): пополнение строки вычитается
        // из её доли сертификата, а остаток возвращённой стоимости делится по остальным способам.
        const netPayments = originalPayments.map((payment, index): SalePaymentTotals => {
            const certificate = Math.min(certificateRefunded[index]!, payment.certificate, refundedShares[index]!);
            const deducted = allocate(refundedShares[index]! - certificate, [payment.cash, payment.cashless, payment.installment]);
            return { cash: payment.cash - deducted[0]!, cashless: payment.cashless - deducted[1]!, installment: payment.installment - deducted[2]!, certificate: payment.certificate - certificate };
        });
        const ownInstallments = installments.filter((row) => row['sale'] === guid);
        const ownFigures = ownInstallments.map((row) => figures.get(String(row['guid']))!);
        const sum = (field: 'amount' | 'paid' | 'refunded' | 'debt') => ownFigures.reduce((total, row) => total + row[field], 0);
        const installmentTotal = originalPayments.reduce((total, payment) => total + payment.installment, 0);
        const unarranged = Math.max(0, installmentTotal - ownInstallments.reduce((total, row) => total + Number(row['amount']), 0));
        const open = installmentTotal > 0 && (unarranged > 0 || ownFigures.some((row) => row.debt > 0));
        const netInstallments = netPayments.map((row) => row.installment);
        const paidShares = allocate(Math.min(sum('paid'), netInstallments.reduce((total, amount) => total + amount, 0)), netInstallments);
        const installmentWeights = originalPayments.map((row) => row.installment);
        const bankPaid = ownInstallments.reduce((sum, row) => sum + (row['type'] === 'Банковская' ? figures.get(String(row['guid']))!.paid : 0), 0);
        const bankShares = allocate(bankPaid, installmentWeights);
        const advanceShares = allocate(sum('paid') - bankPaid, installmentWeights);
        const ownAmount = ownInstallments.reduce((sum, row) => sum + (row['type'] === 'Собственная' ? Number(row['amount']) : 0), 0) + unarranged;
        const ownShares = allocate(ownAmount, installmentWeights);
        const debtShares = allocate(sum('debt') + unarranged, netInstallments.some((value) => value > 0) ? netInstallments : installmentWeights);
        const refunded = [...refunds.values()].reduce((total, amount) => total + amount, 0);
        result.set(guid, {
            sale: guid, number: String(header['number']), date: String(header['date']), amount: Number(header['amount']), refunded, netAmount: Number(header['amount']) - refunded,
            payments: sumPayments(originalPayments), netPayments: sumPayments(netPayments),
            refunds: [...refunds].map(([refund, amount]) => ({ refund, date: refundDates.get(refund)!, amount, goods: refundShares.get(refund)! })),
            installment: { amount: sum('amount'), paid: sum('paid'), refunded: sum('refunded'), debt: sum('debt'), unarranged, open },
            goods: lines.map((line, index): SaleGoodsFigures => ({
                ...identities[index]!, lineNumber: Number(line['lineNumber']), name: String(line['name']), code: nullableText(line['code']), size: nullableText(line['size']), postedIn1C: line['postedIn1C'] === true,
                total: totals[index]!, refunded: refundedShares[index]!, netTotal: totals[index]! - refundedShares[index]!,
                actualCash: originalPayments[index]!.cash - cashRefunded[index]!, actualCashless: originalPayments[index]!.cashless - cashlessRefunded[index]!,
                bankPaid: bankShares[index]!, advancePaid: advanceShares[index]!, ownAmount: ownShares[index]!, debt: debtShares[index]!,
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

/** Продажи и возвраты периода с контекстом старых продаж. Расчёты общие с figures и лентой. */
export const periodFiguresFunction = (builder: FunctionBuilder) => builder.title('Продажи и возвраты периода')
    .input((input) => input.field('periodStart', (field) => field.date().title('С').required())
        .field('periodEnd', (field) => field.date().title('По').required()))
    .handle((input) => Effect.gen(function* () {
        const database = yield* ReadonlyDatabase;
        const metadata = yield* Metadata;
        if (input.periodStart > input.periodEnd) return yield* new DataValidationError({ message: 'Начало периода позже его конца', fields: ['payload.periodStart', 'payload.periodEnd'] });
        const next = new Date(`${input.periodEnd}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        const range = [{ column: 'date', operator: '>=', value: `${input.periodStart}T00:00+00:00` }, { column: 'date', operator: '<', value: `${next.toISOString().slice(0, 10)}T00:00+00:00` }] as const;
        const inPeriod = (value: unknown) => dayOf(String(value)) >= input.periodStart && dayOf(String(value)) <= input.periodEnd;
        const sales = (yield* database.all(query(metadata.find('document', 'sale')!).select({ columns: ['guid', 'date'], where: [...active, ...range] }))).filter((row) => inPeriod(row['date']));
        const refunds = (yield* database.all(query(metadata.find('document', 'refund')!).select({ columns: ['guid', 'date'], where: [...active, ...range] }))).filter((row) => inPeriod(row['date']));
        const returned = yield* readRefundFigures(refunds.map((row) => String(row['guid'])), input.periodEnd);
        const figures = yield* saleFigures([...new Set([...sales.map((row) => String(row['guid'])), ...returned.flatMap((row) => row.sales.map((sale) => sale.guid))])], input.periodEnd);
        return { sales: figures, refunds: returned };
    }));

/** Нейтральная ссылка позволяет вызывать функцию, не импортируя документ продажи. */
export type SaleFunctions = { readonly figures: SignatureOf<ReturnType<typeof figuresFunction>>; readonly periodFigures: SignatureOf<ReturnType<typeof periodFiguresFunction>> };
const saleTarget = { kind: 'document', name: 'sale' } as const;
export const SaleFunctions = saleTarget as typeof saleTarget & { readonly '~functions': SaleFunctions };
