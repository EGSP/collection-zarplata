/** Общие сведения о возвратах для ленты, расчёта продаж и сводки. Документы читаются пакетами. */
import { Effect } from 'effect';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { Metadata, type FunctionBuilder } from '../../server/metadata/index.js';
import { cash, certificateRefill, debtSettlement, paymentMethods } from '../payments.js';
import { dayOf } from '../policies/closed-period.js';

export interface RefundFigures {
    readonly refund: string;
    readonly number: string;
    readonly date: string;
    readonly amount: number;
    /** Денежная выдача, списание долга и пополнение сертификата различаются; происхождение выданных денег не восстанавливается. */
    readonly settlements: ReadonlyArray<{ readonly sale: string; readonly cash: number; readonly cashless: number; readonly debt: number; readonly certificate: number }>;
    readonly methods: ReadonlyArray<string>;
    readonly sales: ReadonlyArray<{ readonly guid: string; readonly number: string; readonly date: string }>;
    readonly goods: ReadonlyArray<{
        readonly sale: string; readonly name: string; readonly code: string | null; readonly size: string | null;
        readonly comment: string | null; readonly cost: number; readonly discount: number | null; readonly couponPercent: number | null; readonly total: number;
    }>;
}

/** Исключает черновики, удалённые документы и возвраты после границы дня. Пустой пакет не читает БД. */
export const readRefundFigures = Effect.fn('refund.figures')(function* (guids: ReadonlyArray<string>, date: string | null) {
    if (guids.length === 0) return [] as RefundFigures[];
    const database = yield* ReadonlyDatabase;
    const metadata = yield* Metadata;
    const refund = metadata.find('document', 'refund')!;
    const sale = metadata.find('document', 'sale')!;
    const headers = (yield* database.all(query(refund).select({ columns: ['guid', 'number', 'date'], where: [
        { column: 'guid', operator: 'IN', value: [...new Set(guids)] },
        { column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null },
    ] }))).filter((row) => date === null || dayOf(String(row['date'])) <= date);
    if (headers.length === 0) return [] as RefundFigures[];
    const owners = headers.map((row) => String(row['guid']));
    const goods = yield* database.all(query(refund).tablePart('goods').select({
        columns: ['ownerGuid', 'sale', 'name', 'code', 'size', 'comment', 'cost', 'discount', 'couponPercent', 'total'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: owners }], orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
    }));
    const settlements = yield* database.all(query(refund).tablePart('settlements').select({
        columns: ['ownerGuid', 'sale', 'method', 'amount'], where: [{ column: 'ownerGuid', operator: 'IN', value: owners }],
    }));
    const bases = yield* database.all(query(refund).tablePart('bases').select({
        columns: ['ownerGuid', 'sale'], where: [{ column: 'ownerGuid', operator: 'IN', value: owners }],
    }));
    const saleGuids = [...new Set([...goods, ...settlements, ...bases].map((row) => String(row['sale'])))];
    const sales = saleGuids.length === 0 ? [] : yield* database.all(query(sale).select({
        columns: ['guid', 'number', 'date'], where: [{ column: 'guid', operator: 'IN', value: saleGuids }],
    }));
    const text = (value: unknown) => value === null || value === undefined ? null : String(value);
    const cashless = paymentMethods.find((method) => method !== cash)!;
    return headers.map((header): RefundFigures => {
        const guid = String(header['guid']);
        const lines = goods.filter((row) => row['ownerGuid'] === guid);
        const payments = settlements.filter((row) => row['ownerGuid'] === guid);
        const related = new Set([...lines, ...payments, ...bases.filter((row) => row['ownerGuid'] === guid)].map((row) => String(row['sale'])));
        return {
            refund: guid, number: String(header['number']), date: String(header['date']),
            amount: lines.reduce((sum, row) => sum + Number(row['total']), 0),
            methods: [...new Set(payments.map((row) => String(row['method'])))],
            settlements: [...related].map((sale) => {
                const amount = (method: string) => payments.filter((row) => row['sale'] === sale && row['method'] === method).reduce((sum, row) => sum + Number(row['amount']), 0);
                return { sale, cash: amount(cash), cashless: amount(cashless), debt: amount(debtSettlement), certificate: amount(certificateRefill) };
            }),
            sales: sales.filter((row) => related.has(String(row['guid']))).map((row) => ({ guid: String(row['guid']), number: String(row['number']), date: String(row['date']) })),
            goods: lines.map((row) => ({ sale: String(row['sale']), name: String(row['name']), code: text(row['code']), size: text(row['size']),
                comment: text(row['comment']), cost: Number(row['cost']), discount: row['discount'] === null ? null : Number(row['discount']),
                couponPercent: row['couponPercent'] == null ? null : Number(row['couponPercent']), total: Number(row['total']) })),
        };
    });
});

/** API возврата использует тот же расчёт, что сводка и лента; суммы положительны, знак задаёт потребитель. */
export const refundFiguresFunction = (builder: FunctionBuilder) => builder.title('Сведения о возвратах')
    .input((input) => input.field('date', (field) => field.date().title('На день'))
        .tablePart('refunds', (part) => part.title('Возвраты').field('guid', (field) => field.string().title('Возврат').required())))
    .handle((input) => readRefundFigures(input.refunds.map((row) => row.guid), input.date ?? null));
