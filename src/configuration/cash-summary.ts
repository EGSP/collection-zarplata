/**
 * Кассовая сводка за день: продажи и возвраты двух зон 1С так, как их раскладывает кассовый чек
 * закрытия дня (раздел «Правила учёта», «Кассовая сводка»). Отчёт только читает данные; его вызывает
 * действие «Кассовая сводка» закрытия периода, а показывает вкладка «Касса» страницы сводки.
 *
 * Правила кассы учитывают долг и сворачивают возврат в день продажи с самой продажей:
 *
 * - первоначальный взнос собственной рассрочки стоит в колонке своего способа оплаты;
 * - «Рассрочка» содержит оплату банком и остаток собственной рассрочки за вычетом первоначального
 *   взноса, то есть долг, а не полученные деньги;
 * - погашение долга возвратом стоит в «Рассрочке» со знаком минус.
 *
 * Поэтому «Итого» кассы совпадает с кассовым чеком, а не с вкладкой «Период» за тот же день.
 * Взносов по старым рассрочкам касса не показывает, и в итог они не входят.
 */
import { Effect } from 'effect';
import { callFunction } from '../server/data/action-context.js';
import { ReadonlyDatabase } from '../server/database/database.effect.js';
import { query } from '../server/database/sql.builder.js';
import { SaleInstallment } from './documents/sale-installment.document.js';
import { Sale } from './documents/sale.document.js';
import { initialPayments } from './installment-initial-payments.js';
import { ownInstallment } from './installments.js';
import { cash } from './payments.js';
import { addSummaryAmounts, emptySummaryAmounts, summaryOperations, type SummaryAmounts, type SummaryTotals } from './period-summary-operations.js';
import { dayOf } from './policies/closed-period.js';
import { breakdownOf, emptyBreakdown } from './summary-breakdown.js';
import { summaryPaymentSources } from './summary-payment-sources.js';

/** Кассовая сводка за день. */
export interface CashSummary {
    readonly day: string;
    /** Продажи и возвраты двух зон 1С по правилам кассы. */
    readonly operations: ReturnType<typeof summaryOperations>;
    /** Итог «Всего»: только две зоны, без взносов. */
    readonly totals: SummaryTotals;
}

/** Отчёт для экрана сверки с отпечатком именно показанных строк и сумм. */
export interface CashSummaryForReview extends CashSummary {
    readonly reviewVersion: string;
}

/** Отпечаток защищает отметку от изменения отчёта между просмотром и нажатием кнопки. */
export const cashSummaryVersion = Effect.fnUntraced(function* (summary: CashSummary) {
    const bytes = new TextEncoder().encode(JSON.stringify(summary));
    const digest = yield* Effect.promise(() => crypto.subtle.digest('SHA-256', bytes));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
});

/** Отбор действующих проведённых документов. */
const active = [
    { column: 'posted', operator: '=', value: true },
    { column: 'deletedAt', operator: '=', value: null },
] as const;

/**
 * Строит кассовую сводку за день `day` (`ГГГГ-ММ-ДД`).
 *
 * Продажи и возвраты дня отдаёт функция продажи `periodFigures`, как в сводке за период. Деньги
 * рассрочки каждой продажи дня собираются по колонкам и передаются `summaryOperations`, которая
 * делит их между товарами и зонами:
 *
 * - первоначальный взнос собственной рассрочки, внесённый в этот день, — в «Наличные»
 *   или «Безналичные» по способу взноса;
 * - взносы банковской рассрочки (оплата банком), внесённые в этот день, — в «Рассрочку», как в периоде;
 * - сумма собственной рассрочки продажи за вычетом её первоначального взноса — в «Рассрочку».
 *   Сумму даёт `ownAmount` товаров продажи: в неё входит и оплата «Рассрочка», по которой рассрочка
 *   ещё не оформлена, поэтому такая продажа показывает в «Рассрочке» всю эту сумму.
 *
 * Первоначальный взнос определяется тем же правилом, что в сводке за период (`initialPayments`).
 */
export const cashSummary = (day: string) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const figures = yield* callFunction(Sale, 'periodFigures', { periodStart: day, periodEnd: day });
    // В `sales` есть и продажи-основания возвратов дня из прошлых дней: строки и рассрочка нужны
    // только продажам самого дня.
    const daySales = figures.sales.filter((sale) => dayOf(sale.date) === day);

    const installments = daySales.length === 0 ? [] : yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'date', 'sale', 'type'],
        where: [...active, { column: 'sale', operator: 'IN', value: daySales.map((sale) => sale.sale) }],
        orderBy: [{ column: 'guid', direction: 'ASC' }],
    }));
    // Взносы читаются в порядке строк: по нему правило первоначального взноса выбирает первый
    // из взносов с равным моментом.
    const installmentPayments = installments.length === 0 ? [] : yield* database.all(query(SaleInstallment).tablePart('payments').select({
        columns: ['ownerGuid', 'date', 'method', 'amount', 'receiver'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: installments.map((installment) => installment.guid) }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const sources = yield* summaryPaymentSources(daySales.map((sale) => sale.sale), figures.refunds.map((refund) => refund.refund), installmentPayments);
    const installmentBreakdowns = new Map<string, ReturnType<typeof emptyBreakdown>>();

    // Первоначальные взносы дня по продажам: собственные по способу, банковские в «Рассрочку».
    const initial = new Map<string, SummaryAmounts>();
    for (const installment of installments) {
        const payments = installmentPayments.filter((payment) => payment.ownerGuid === installment.guid);
        for (const payment of initialPayments(installment, payments)) {
            if (dayOf(payment.date) !== day) continue;
            const own = installment.type === ownInstallment;
            const column = own ? (payment.method === cash ? 'cash' : 'cashless') : 'installment';
            breakdownOf(installmentBreakdowns, installment.sale)[column].push(sources.payment(payment.receiver, payment.amount));
            const amounts: SummaryAmounts = {
                cash: own && payment.method === cash ? payment.amount : 0,
                cashless: own && payment.method !== cash ? payment.amount : 0,
                installment: own ? 0 : payment.amount,
            };
            initial.set(installment.sale, addSummaryAmounts(initial.get(installment.sale) ?? emptySummaryAmounts(), amounts));
        }
    }
    // Остаток собственной рассрочки: её сумма за вычетом первоначального взноса, ушедшего в колонки способов.
    for (const sale of daySales) {
        const ownAmount = sale.goods.reduce((sum, line) => sum + line.ownAmount, 0);
        if (ownAmount === 0) continue;
        const current = initial.get(sale.sale) ?? emptySummaryAmounts();
        const balance = ownAmount - current.cash - current.cashless;
        initial.set(sale.sale, { ...current, installment: current.installment + balance });
        breakdownOf(installmentBreakdowns, sale.sale).installment.push({ kind: 'balance', name: 'Остаток долга', amount: balance });
    }

    // Ссылок на взносы нет: таблицы «Взносы» в кассе нет.
    const empty = emptyBreakdown();
    const operations = summaryOperations({
        sales: figures.sales, refunds: figures.refunds, from: day, initial, payments: [],
        sources: { ...sources, installment: (sale) => installmentBreakdowns.get(sale) ?? empty },
    });
    const result: CashSummary = { day, operations, totals: operations.totals };
    return result;
});
