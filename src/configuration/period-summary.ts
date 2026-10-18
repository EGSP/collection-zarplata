/**
 * Отчёт «Сводка за период»: продажи, проведённые и не проведённые в 1С, взносы по рассрочкам,
 * товары в отвесе и должники. Отчёт только читает данные; его вызывает действие «Сводка за период»
 * закрытия периода, а показывает страница `pages/period-summary.page-component.tsx`.
 *
 * Период задаётся днями включительно. День события сравнивается по первым десяти знакам даты,
 * как в политике закрытого периода и в расчёте зарплаты.
 */
import { Effect } from 'effect';
import { Database } from '../server/database/database.effect.js';
import { query } from '../server/database/sql.builder.js';
import { SaleInstallment } from './documents/sale-installment.document.js';
import { Sale } from './documents/sale.document.js';
import { Weighing } from './documents/weighing.document.js';
import { allocate } from './payroll-context.js';
import { nextDay } from './payroll.js';
import { cash, installmentMethod, paymentMethods } from './payments.js';
import { dayOf } from './policies/closed-period.js';

/** Безналичная оплата: второй способ, которым принимаются деньги. */
const cashless = paymentMethods.find((method) => method !== cash)!;

/** Суммы по способам оплаты. */
export interface PaymentTotals {
    readonly cash: number;
    readonly cashless: number;
    readonly installment: number;
}

/** Товар проведённой продажи. Суммы оплат — доли оплат продажи, приходящиеся на товар. */
export interface SummaryGoodsRow {
    readonly sale: string;
    readonly date: string;
    readonly name: string;
    readonly code: string | null;
    readonly size: string | null;
    readonly total: number;
    readonly payments: PaymentTotals;
    /** Доля взносов по рассрочкам продажи, внесённых по конец периода, приходящаяся на товар. */
    readonly installmentPaid: number;
    /** Рассрочка продажи на конец периода не закрыта или ещё не оформлена: в рассрочку есть непогашенная часть. */
    readonly installmentOpen: boolean;
}

/** Блок товаров с итогом по способам оплаты. */
export interface SummaryGoodsBlock {
    readonly rows: ReadonlyArray<SummaryGoodsRow>;
    readonly totals: PaymentTotals;
    readonly total: number;
    /** Внесённая часть сумм в рассрочку: взносы по конец периода. */
    readonly installmentPaid: number;
}

/** Взнос по рассрочке. */
export interface SummaryPaymentRow {
    readonly installment: string;
    readonly sale: string;
    readonly person: string | null;
    readonly date: string;
    readonly method: string;
    readonly amount: number;
}

/** Товар в отвесе. */
export interface SummaryWeighingRow {
    readonly weighing: string;
    readonly person: string;
    readonly date: string;
    readonly name: string;
    readonly code: string | null;
    readonly size: string | null;
    readonly total: number;
}

/** Рассрочка должника с долгом на конец периода. */
export interface SummaryDebt {
    readonly installment: string;
    readonly sale: string;
    readonly date: string;
    readonly amount: number;
    readonly debt: number;
}

/** Должник: покупатель и его рассрочки с долгом. */
export interface SummaryDebtor {
    readonly person: string;
    readonly debt: number;
    readonly installments: ReadonlyArray<SummaryDebt>;
}

/** Сводка за период. */
export interface PeriodSummary {
    readonly from: string;
    readonly to: string;
    readonly postedIn1C: SummaryGoodsBlock;
    readonly notPostedIn1C: SummaryGoodsBlock;
    /** Совокупные итоги продаж: проведённые и не проведённые в 1С товары вместе. */
    readonly allSales: { readonly count: number; readonly totals: PaymentTotals; readonly total: number; readonly installmentPaid: number };
    readonly payments: { readonly rows: ReadonlyArray<SummaryPaymentRow>; readonly totals: PaymentTotals };
    readonly weighings: { readonly rows: ReadonlyArray<SummaryWeighingRow>; readonly total: number };
    readonly debtors: { readonly rows: ReadonlyArray<SummaryDebtor>; readonly total: number };
}

/** Отбор действующих проведённых документов. */
const active = [
    { column: 'posted', operator: '=', value: true },
    { column: 'deletedAt', operator: '=', value: null },
] as const;

const noPayments: PaymentTotals = { cash: 0, cashless: 0, installment: 0 };

const addTotals = (first: PaymentTotals, second: PaymentTotals): PaymentTotals => ({
    cash: first.cash + second.cash, cashless: first.cashless + second.cashless, installment: first.installment + second.installment,
});

/** Момент даты: строки хранятся с часовым поясом клиента, поэтому сортировка идёт по моментам. */
const moment = (value: string): number => new Date(value).getTime();

/**
 * Строит сводку с дня `from` по день `to` включительно.
 *
 * - Продажи: проведённые продажи периода по товарам, раздельно проведённые и не проведённые
 *   в 1С (отметка строки товара). Оплаты продажи хранятся целиком, поэтому каждая оплата делится
 *   между товарами пропорционально их итогам; итоги блока — суммы этих долей. Совокупные итоги
 *   складывают оба блока: это все проведённые продажи периода. Для части в рассрочку считается
 *   и внесённая часть: взносы по рассрочкам продажи по конец периода, включая оплату банком,
 *   делятся между товарами пропорционально их долям рассрочки. Рассрочка считается незакрытой,
 *   если на конец периода у продажи есть незакрытая или неоформленная рассрочка.
 * - Взносы: взносы проведённых рассрочек с датой в периоде.
 * - Отвесы: строки, которые сейчас в состоянии «В отвесе», у отвесов с датой не позже конца
 *   периода. Отвес не хранит историю состояний строк, поэтому берётся текущее.
 * - Должники: проведённые рассрочки, оформленные не позже конца периода, с долгом на его конец:
 *   сумма рассрочки за вычетом взносов, внесённых по этот день.
 */
export const periodSummary = (from: string, to: string) => Effect.gen(function* () {
    const database = yield* Database;
    const inPeriod = (date: string) => dayOf(date) >= from && dayOf(date) <= to;
    // Граница дня записана наименьшей строкой этого дня, которую принимает поле даты со временем.
    const dayStart = (day: string) => `${day}T00:00+00:00`;
    const end = dayStart(nextDay(to));

    // Продажи периода по товарам.
    const sales = (yield* database.all(query(Sale).select({
        columns: ['guid', 'date'],
        where: [...active, { column: 'date', operator: '>=', value: dayStart(from) }, { column: 'date', operator: '<', value: end }],
    }))).filter((sale) => inPeriod(sale.date)).sort((first, second) => moment(first.date) - moment(second.date));
    const saleGuids = sales.map((sale) => sale.guid);
    const goods = saleGuids.length === 0 ? [] : yield* database.all(query(Sale).tablePart('goods').select({
        columns: ['ownerGuid', 'name', 'code', 'size', 'total', 'postedIn1C'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: saleGuids }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const payments = saleGuids.length === 0 ? [] : yield* database.all(query(Sale).tablePart('payments').select({
        columns: ['ownerGuid', 'method', 'amount'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: saleGuids }],
    }));
    // Рассрочки продаж периода с взносами: по ним считается внесённая часть суммы в рассрочку.
    const saleInstallments = saleGuids.length === 0 ? [] : (yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'date', 'sale', 'amount', 'closedAt'],
        where: [...active, { column: 'sale', operator: 'IN', value: saleGuids }],
    }))).filter((installment) => dayOf(installment.date) <= to);
    const saleInstallmentPayments = saleInstallments.length === 0 ? [] : yield* database.all(query(SaleInstallment).tablePart('payments').select({
        columns: ['ownerGuid', 'date', 'amount'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: saleInstallments.map((installment) => installment.guid) }],
    }));
    const posted: SummaryGoodsRow[] = [];
    const notPosted: SummaryGoodsRow[] = [];
    for (const sale of sales) {
        const lines = goods.filter((line) => line.ownerGuid === sale.guid);
        const totals = lines.map((line) => line.total);
        const byMethod = (method: string) => allocate(payments.filter((payment) => payment.ownerGuid === sale.guid && payment.method === method).reduce((sum, payment) => sum + payment.amount, 0), totals);
        const cashShares = byMethod(cash);
        const cashlessShares = byMethod(cashless);
        const installmentShares = byMethod(installmentMethod);
        const installmentTotal = installmentShares.reduce((sum, share) => sum + share, 0);
        const ownInstallments = saleInstallments.filter((installment) => installment.sale === sale.guid);
        const paid = saleInstallmentPayments
            .filter((payment) => ownInstallments.some((installment) => installment.guid === payment.ownerGuid) && dayOf(payment.date) <= to)
            .reduce((sum, payment) => sum + payment.amount, 0);
        const arranged = ownInstallments.reduce((sum, installment) => sum + installment.amount, 0);
        // Незакрыта рассрочка, закрытая позже периода, и сумма в рассрочку, на которую рассрочку ещё не оформили.
        const open = installmentTotal > 0 && (arranged < installmentTotal
            || ownInstallments.some((installment) => installment.closedAt === null || dayOf(installment.closedAt) > to));
        // Взносы делятся между товарами по их долям рассрочки и не превышают суммы в рассрочку.
        const paidShares = allocate(Math.min(paid, installmentTotal), installmentShares);
        lines.forEach((line, index) => {
            const row: SummaryGoodsRow = {
                sale: sale.guid, date: sale.date, name: line.name, code: line.code, size: line.size, total: line.total,
                payments: { cash: cashShares[index]!, cashless: cashlessShares[index]!, installment: installmentShares[index]! },
                installmentPaid: paidShares[index]!,
                installmentOpen: open && installmentShares[index]! > 0,
            };
            (line.postedIn1C === true ? posted : notPosted).push(row);
        });
    }
    const block = (rows: ReadonlyArray<SummaryGoodsRow>): SummaryGoodsBlock => ({
        rows,
        totals: rows.reduce((sum, row) => addTotals(sum, row.payments), noPayments),
        total: rows.reduce((sum, row) => sum + row.total, 0),
        installmentPaid: rows.reduce((sum, row) => sum + row.installmentPaid, 0),
    });

    // Рассрочки, оформленные не позже конца периода: по ним считаются взносы периода и долги.
    const installments = (yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'date', 'sale', 'person', 'amount'],
        where: [...active, { column: 'date', operator: '<', value: end }],
    }))).filter((installment) => dayOf(installment.date) <= to);
    const installmentPayments = installments.length === 0 ? [] : yield* database.all(query(SaleInstallment).tablePart('payments').select({
        columns: ['ownerGuid', 'date', 'method', 'amount'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: installments.map((installment) => installment.guid) }],
    }));
    const installmentByGuid = new Map(installments.map((installment) => [installment.guid, installment]));
    const paymentRows: SummaryPaymentRow[] = installmentPayments
        .filter((payment) => inPeriod(payment.date))
        .sort((first, second) => moment(first.date) - moment(second.date))
        .map((payment) => {
            const installment = installmentByGuid.get(payment.ownerGuid)!;
            return { installment: installment.guid, sale: installment.sale, person: installment.person, date: payment.date, method: payment.method, amount: payment.amount };
        });
    const paymentTotals: PaymentTotals = {
        cash: paymentRows.filter((row) => row.method === cash).reduce((sum, row) => sum + row.amount, 0),
        cashless: paymentRows.filter((row) => row.method === cashless).reduce((sum, row) => sum + row.amount, 0),
        installment: 0,
    };

    // Долг рассрочки на конец периода: взносы после него ещё не внесены.
    const debtors = new Map<string, SummaryDebt[]>();
    for (const installment of installments) {
        if (installment.person === null) continue;
        const paid = installmentPayments
            .filter((payment) => payment.ownerGuid === installment.guid && dayOf(payment.date) <= to)
            .reduce((sum, payment) => sum + payment.amount, 0);
        const debt = installment.amount - paid;
        if (debt <= 0) continue;
        debtors.set(installment.person, [...debtors.get(installment.person) ?? [], { installment: installment.guid, sale: installment.sale, date: installment.date, amount: installment.amount, debt }]);
    }
    const debtorRows: SummaryDebtor[] = [...debtors].map(([person, debts]) => ({
        person, debt: debts.reduce((sum, item) => sum + item.debt, 0), installments: debts.sort((first, second) => moment(first.date) - moment(second.date)),
    })).sort((first, second) => second.debt - first.debt);

    // Товары в отвесе у отвесов, оформленных не позже конца периода.
    const weighings = (yield* database.all(query(Weighing).select({
        columns: ['guid', 'date', 'person'],
        where: [...active, { column: 'date', operator: '<', value: end }],
    }))).filter((weighing) => dayOf(weighing.date) <= to);
    const weighingLines = weighings.length === 0 ? [] : yield* database.all(query(Weighing).tablePart('goods').select({
        columns: ['ownerGuid', 'name', 'code', 'size', 'total', 'state'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: weighings.map((weighing) => weighing.guid) }, { column: 'state', operator: '=', value: 'В отвесе' }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const weighingRows: SummaryWeighingRow[] = weighings
        .sort((first, second) => moment(first.date) - moment(second.date))
        .flatMap((weighing) => weighingLines.filter((line) => line.ownerGuid === weighing.guid).map((line) => ({
            weighing: weighing.guid, person: weighing.person, date: weighing.date, name: line.name, code: line.code, size: line.size, total: line.total,
        })));

    const postedBlock = block(posted);
    const notPostedBlock = block(notPosted);
    const result: PeriodSummary = {
        from, to,
        postedIn1C: postedBlock,
        notPostedIn1C: notPostedBlock,
        allSales: {
            count: posted.length + notPosted.length,
            totals: addTotals(postedBlock.totals, notPostedBlock.totals),
            total: postedBlock.total + notPostedBlock.total,
            installmentPaid: postedBlock.installmentPaid + notPostedBlock.installmentPaid,
        },
        payments: { rows: paymentRows, totals: paymentTotals },
        weighings: { rows: weighingRows, total: weighingRows.reduce((sum, row) => sum + row.total, 0) },
        debtors: { rows: debtorRows, total: debtorRows.reduce((sum, row) => sum + row.debt, 0) },
    };
    return result;
});
