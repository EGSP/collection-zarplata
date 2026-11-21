import { Effect } from 'effect';
import { ReadonlyDatabase } from '../server/database/database.effect.js';
import { query } from '../server/database/sql.builder.js';
import { compositeReference, isCompositeValue } from '../server/metadata/composite.js';
import { PaymentReceivers } from './catalogs/payment-receivers.catalog.js';
import { Refund } from './documents/refund.document.js';
import { Sale } from './documents/sale.document.js';
import { cash, debtSettlement, paymentMethods } from './payments.js';
import { breakdownOf, emptyBreakdown, type BreakdownEntry } from './summary-breakdown.js';

/** Читает приёмники оплат и источники выдач обеих сводок, включая их дополнительные операции. */
export const summaryPaymentSources = Effect.fnUntraced(function* (
    sales: ReadonlyArray<string>,
    refunds: ReadonlyArray<string>,
    additionalPayments: ReadonlyArray<{ readonly receiver: unknown }>,
) {
    const database = yield* ReadonlyDatabase;
    const salePayments = sales.length === 0 ? [] : yield* database.all(query(Sale).tablePart('payments').select({
        columns: ['ownerGuid', 'method', 'amount', 'receiver'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: sales }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const settlements = refunds.length === 0 ? [] : yield* database.all(query(Refund).tablePart('settlements').select({
        columns: ['ownerGuid', 'sale', 'method', 'amount', 'receiver'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: refunds }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const references = [...new Set([...salePayments, ...settlements, ...additionalPayments].flatMap(({ receiver }) => {
        const reference = compositeReference(receiver);
        return reference === null ? [] : [reference.guid];
    }))];
    const receivers = references.length === 0 ? [] : yield* database.all(query(PaymentReceivers).select({
        columns: ['guid', 'name'],
        where: [{ column: 'guid', operator: 'IN', value: references }],
    }));
    const names = new Map(receivers.map(({ guid, name }) => [guid, name]));

    /** Исторические строки без приёмника сохраняют сумму в позиции «Не указан». */
    const payment = (receiver: unknown, amount: number, group?: BreakdownEntry['group']): BreakdownEntry => {
        const reference = compositeReference(receiver);
        const name = reference === null
            ? (isCompositeValue(receiver) && receiver.type === 'string' ? receiver.value : null)
            : names.get(reference.guid);
        const entry: BreakdownEntry = name ? { kind: 'receiver', name, amount } : { kind: 'missing', name: 'Не указан', amount };
        return group === undefined ? entry : { ...entry, group };
    };

    const salesBreakdown = new Map<string, ReturnType<typeof emptyBreakdown>>();
    const refundsBreakdown = new Map<string, ReturnType<typeof emptyBreakdown>>();
    for (const line of salePayments) {
        if (!paymentMethods.some((method) => method === line.method)) continue;
        const column = line.method === cash ? 'cash' : 'cashless';
        breakdownOf(salesBreakdown, line.ownerGuid)[column].push(payment(line.receiver, line.amount));
    }
    for (const line of settlements) {
        const key = JSON.stringify([line.ownerGuid, line.sale]);
        if (line.method === debtSettlement) {
            breakdownOf(refundsBreakdown, key).installment.push({ kind: 'debt', name: debtSettlement, amount: line.amount });
        } else if (paymentMethods.some((method) => method === line.method)) {
            const column = line.method === cash ? 'cash' : 'cashless';
            breakdownOf(refundsBreakdown, key)[column].push(payment(line.receiver, line.amount));
        }
    }

    const empty = emptyBreakdown();
    return {
        payment,
        // Расчёт возврата относится к одной исходной продаже, даже если документ возвращает несколько.
        sale: (guid: string) => salesBreakdown.get(guid) ?? empty,
        refund: (refund: string, sale: string) => refundsBreakdown.get(JSON.stringify([refund, sale])) ?? empty,
    };
});
