/**
 * Отчёт «Сводка за период»: продажи, проведённые и не проведённые в 1С, взносы по рассрочкам,
 * товары в отвесе и должники. Отчёт только читает данные; его вызывает действие «Сводка за период»
 * закрытия периода, а показывает страница `pages/period-summary.page-component.tsx`.
 *
 * Период задаётся днями включительно. День события сравнивается по первым десяти знакам даты,
 * как в политике закрытого периода и в расчёте зарплаты.
 */
import { addSummaryAmounts, summaryOperations, type SummaryAmounts } from './period-summary-operations.js';
import { initialPayments } from './installment-initial-payments.js';
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

/** Суммы взносов по способам. */
export interface PaymentTotals {
    readonly cash: number;
    readonly cashless: number;
}

/**
 * Взнос таблицы «Взносы»: последующий взнос либо первоначальный взнос продажи вне периода.
 * Первоначальные взносы продаж периода стоят в строках продаж и сюда не входят.
 */
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
    /** Продажи и возвраты двух зон 1С. */
    readonly operations: ReturnType<typeof summaryOperations>;
    /** Все деньги периода: обе зоны и таблица «Взносы». Каждая сумма входит ровно в одно слагаемое. */
    readonly totals: SummaryAmounts;
    readonly from: string;
    readonly to: string;
    readonly payments: { readonly rows: ReadonlyArray<SummaryPaymentRow>; readonly totals: PaymentTotals };
    readonly weighings: { readonly rows: ReadonlyArray<SummaryWeighingRow>; readonly total: number };
    readonly debtors: { readonly rows: ReadonlyArray<SummaryDebtor>; readonly total: number };
}

/** Отбор действующих проведённых документов. */
const active = [
    { column: 'posted', operator: '=', value: true },
    { column: 'deletedAt', operator: '=', value: null },
] as const;

/** Момент даты: строки хранятся с часовым поясом клиента, поэтому сортировка идёт по моментам. */
const moment = (value: string): number => new Date(value).getTime();

/**
 * Строит сводку с дня `from` по день `to` включительно.
 *
 * - Продажи и возвраты: функция продажи `periodFigures` отдаёт товары, доли оплат и выдачи возвратов,
 *   `summaryOperations` раскладывает их по зонам 1С. В суммы входят только деньги: оплаты,
 *   первоначальный взнос и выдачи возвратов; долг рассрочки и его списание возвратом не входят.
 * - Взносы: взносы проведённых рассрочек с датой в периоде, кроме первоначальных взносов продаж
 *   периода (`initialPayments`): те уже стоят в строке продажи.
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
    // Рассрочки, оформленные не позже конца периода, и их суммы на его конец: по ним считаются
    // внесённая часть продаж периода, взносы периода и долги.
    const installments = (yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'date', 'sale', 'type', 'person', 'amount'],
        where: [...active, { column: 'date', operator: '<', value: end }],
    }))).filter((installment) => dayOf(installment.date) <= to);
    const figures = new Map((yield* callFunction(SaleInstallment, 'figures', {
        date: to,
        installments: installments.map((installment) => ({ guid: installment.guid })),
    })).map((item) => [item.installment, item]));
    const figuresOf = (guid: string) => figures.get(guid)!;

    // Взносы читаются строками в порядке строк: по нему правило первоначального взноса выбирает
    // первый из взносов с равным моментом.
    const installmentPayments = installments.length === 0 ? [] : yield* database.all(query(SaleInstallment).tablePart('payments').select({
        columns: ['ownerGuid', 'lineNumber', 'date', 'method', 'amount'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: installments.map((installment) => installment.guid) }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    // Первоначальный взнос продажи периода стоит в строке продажи (колонка «Рассрочка»), остальные
    // взносы периода — в таблице «Взносы». Первоначальный взнос продажи вне периода тоже идёт
    // в таблицу: строки этой продажи в сводке нет, и иначе деньги пропали бы из итога.
    const periodSales = new Set(saleGuids);
    const initial = new Map<string, number>();
    const paymentRows: SummaryPaymentRow[] = [];
    for (const installment of installments) {
        const payments = installmentPayments.filter((payment) => payment.ownerGuid === installment.guid);
        const initialOfInstallment = initialPayments(installment, payments);
        for (const payment of payments) {
            if (!inPeriod(payment.date)) continue;
            if (initialOfInstallment.has(payment) && periodSales.has(installment.sale)) {
                initial.set(installment.sale, (initial.get(installment.sale) ?? 0) + payment.amount);
                continue;
            }
            paymentRows.push({ installment: installment.guid, sale: installment.sale, person: installment.person, date: payment.date, method: payment.method, amount: payment.amount });
        }
    }
    paymentRows.sort((first, second) => moment(first.date) - moment(second.date));
    const paymentTotals: PaymentTotals = {
        cash: paymentRows.filter((row) => row.method === cash).reduce((sum, row) => sum + row.amount, 0),
        cashless: paymentRows.filter((row) => row.method === cashless).reduce((sum, row) => sum + row.amount, 0),
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

    const operations = summaryOperations(periodFigures.sales, periodFigures.refunds, from, initial, paymentRows);
    const result: PeriodSummary = {
        from, to, operations,
        totals: addSummaryAmounts(operations.totals, { ...paymentTotals, installment: 0 }),
        payments: { rows: paymentRows, totals: paymentTotals },
        weighings: { rows: weighingRows, total: weighingRows.reduce((sum, row) => sum + row.total, 0) },
        debtors: { rows: debtorRows, total: debtorRows.reduce((sum, row) => sum + row.debt, 0) },
    };
    return result;
});
