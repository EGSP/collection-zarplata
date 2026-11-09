/**
 * Отчёт «Сводка за период»: продажи, проведённые и не проведённые в 1С, взносы по рассрочкам,
 * товары в отвесе и должники. Отчёт только читает данные; его вызывает действие «Сводка за период»
 * закрытия периода, а показывает страница `pages/period-summary.page-component.tsx`.
 *
 * Период задаётся днями включительно. День события сравнивается по первым десяти знакам даты,
 * как в политике закрытого периода и в расчёте зарплаты.
 */
import { summaryOperations } from './period-summary-operations.js';
import { Effect } from 'effect';
import { callFunction } from '../server/data/action-context.js';
import { ReadonlyDatabase } from '../server/database/database.effect.js';
import { query } from '../server/database/sql.builder.js';
import { SaleInstallment } from './documents/sale-installment.document.js';
import { Sale } from './documents/sale.document.js';
import { Weighing } from './documents/weighing.document.js';
import { nextDay } from './payroll.js';
import { cash, paymentMethods } from './payments.js';
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
    /** Доля взносов по рассрочкам продажи, внесённых по конец периода, приходящаяся на товар. Погашения возвратами сюда не входят. */
    readonly installmentPaid: number;
    /** На конец периода у рассрочки продажи есть долг или рассрочка оформлена не на всю сумму в рассрочку. */
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
    /**
     * Сумма рассрочки за вычетом погашений возвратами на конец периода. Исходная сумма рядом
     * с долгом читалась бы как частично внесённая, хотя часть долга погасил возврат, а не деньги.
     */
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
    readonly operations: ReturnType<typeof summaryOperations>;
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
 * - Продажи: функция продажи `figures` отдаёт товары с вычетом возвратов по конец периода,
 *   оставшиеся доли оплат и состояние рассрочки. Здесь строки только группируются по отметке 1С.
 * - Взносы: взносы проведённых рассрочек с датой в периоде.
 * - Отвесы: строки, которые сейчас в состоянии «В отвесе», у отвесов с датой не позже конца
 *   периода. Отвес не хранит историю состояний строк, поэтому берётся текущее.
 * - Должники: проведённые рассрочки, оформленные не позже конца периода, с долгом на его конец:
 *   сумма рассрочки за вычетом взносов и погашений возвратами по этот день. Сумму рассрочки
 *   должник видит уже за вычетом погашений возвратами: её разница с долгом — только взносы.
 *
 * Взносы, погашения и долг рассрочек на конец периода считает функция рассрочек `figures`:
 * по ней же их показывают формы продажи и рассрочки.
 */
export const periodSummary = (from: string, to: string) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
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
    const periodFigures = yield* callFunction(Sale, 'periodFigures', { periodStart: from, periodEnd: to });
    const saleFigures = periodFigures.sales.filter((sale) => saleGuids.includes(sale.sale));
    // Рассрочки, оформленные не позже конца периода, и их суммы на его конец: по ним считаются
    // внесённая часть продаж периода, взносы периода и долги.
    const installments = (yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'date', 'sale', 'person', 'amount'],
        where: [...active, { column: 'date', operator: '<', value: end }],
    }))).filter((installment) => dayOf(installment.date) <= to);
    const figures = new Map((yield* callFunction(SaleInstallment, 'figures', {
        date: to,
        installments: installments.map((installment) => ({ guid: installment.guid })),
    })).map((item) => [item.installment, item]));
    const figuresOf = (guid: string) => figures.get(guid)!;
    const posted: SummaryGoodsRow[] = [];
    const notPosted: SummaryGoodsRow[] = [];
    // Деление оплат и вычет возвратов выполняет функция продажи; сводка только группирует её строки.
    // Доля сертификатов в сводку не входит: она показывает только фактическую оплату деньгами
    // и рассрочкой (раздел «Правила учёта», подраздел «Сводка за период»).
    for (const sale of saleFigures) {
        for (const line of sale.goods) {
            const { cash: lineCash, cashless, installment } = line.netPayments;
            const row: SummaryGoodsRow = {
                sale: sale.sale, date: sale.date, name: line.name, code: line.code, size: line.size, total: line.netTotal,
                payments: { cash: lineCash, cashless, installment }, installmentPaid: line.installmentPaid, installmentOpen: line.installmentOpen,
            };
            (line.postedIn1C ? posted : notPosted).push(row);
        }
    }
    const block = (rows: ReadonlyArray<SummaryGoodsRow>): SummaryGoodsBlock => ({
        rows,
        totals: rows.reduce((sum, row) => addTotals(sum, row.payments), noPayments),
        total: rows.reduce((sum, row) => sum + row.total, 0),
        installmentPaid: rows.reduce((sum, row) => sum + row.installmentPaid, 0),
    });

    // Взносы периода перечисляются строками, поэтому читаются из рассрочек, а не из итогов.
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

    // Долг рассрочки на конец периода: взносы и погашения после него ещё не учтены.
    const debtors = new Map<string, SummaryDebt[]>();
    for (const installment of installments) {
        if (installment.person === null) continue;
        const { amount, refunded, debt } = figuresOf(installment.guid);
        if (debt <= 0) continue;
        debtors.set(installment.person, [...debtors.get(installment.person) ?? [], { installment: installment.guid, sale: installment.sale, date: installment.date, amount: amount - refunded, debt }]);
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
        operations: summaryOperations(periodFigures.sales, periodFigures.refunds, from),
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
