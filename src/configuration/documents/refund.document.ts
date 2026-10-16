/**
 * Возврат: товары, которые покупатель вернул по продажам. Строка товара ссылается на продажу.
 * Проведённый возврат записывает в регистр «Продажи» сумму своих строк с минусом по каждой
 * продаже и этим уменьшает сумму, которую по ней ещё можно вернуть; саму продажу возврат
 * не изменяет. Движение относится к смене продажи, а не к смене возврата: результат смены
 * считается с учётом возвратов по её продажам. Смена в шапке показывает, когда возврат оформлен.
 *
 * Предел возврата проверяет ограничение итога регистра, а не политика: оно действует при
 * проведении и при записи проведённого возврата, а непроведённый возврат записывается без
 * проверки, как черновик.
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { Database } from '../../server/database/database.effect.js';
import { document, movements, type Policy } from '../../server/metadata/index.js';
import { Goods } from '../goods.js';
import { Sales } from '../registers/sales.register.js';
import { Sale } from './sale.document.js';
import { preventPostedDocumentDeletion } from '../policies/posted-document-deletion.js';
import { Shift } from './shift.document.js';

/** Состав возврата, который проверяет правило: шапка с признаком проведения и строки оснований и товаров. */
interface RefundContent {
    readonly bases: ReadonlyArray<{ readonly sale: string }>;
    readonly goods: ReadonlyArray<{ readonly sale: string }>;
}

/**
 * Состав возврата (раздел «Правила учёта»): в нём должны быть товары, основания
 * и каждый товар должен относиться к продаже из оснований.
 */
const checkRefundContent = (refund: RefundContent) => Effect.gen(function* () {
    if (refund.goods.length === 0) return yield* new DataPolicyError({ message: 'В возврате нет товаров: провести можно только возврат с товарами' });
    if (refund.bases.length === 0) return yield* new DataPolicyError({ message: 'Возврат не связан ни с одной продажей' });
    const bases = new Set(refund.bases.map((line) => line.sale));
    for (const [index, line] of refund.goods.entries()) {
        if (!bases.has(line.sale)) return yield* new DataPolicyError({ message: `Строка ${index + 1}: товар не из продажи, связанной с возвратом` });
    }
});

/**
 * Правила состава возврата. Проверка одинакова при записи и при проведении, не зависит от статуса
 * проведения: записать возврат с нарушенным составом нельзя даже в черновике.
 */
const refundGoods: Policy<RefundContent> = {
    name: 'refund-goods',
    save: ({ proposedRecord }) => checkRefundContent(proposedRecord),
    post: ({ document }) => checkRefundContent(document),
};

/**
 * Товары в возврат добавляет элемент `RefundSales`: он показывает товары продаж из части
 * «На основании», и нажатие на товар копирует его в товары возврата со ссылкой на продажу.
 */
export const Refund = document('refund')
    .title('Возврат')
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    .tablePart('bases', (part) => part
        .title('На основании')
        .field('sale', (field) => field.reference(Sale).title('Продажа').required()))
    .tablePart('goods', (part) => part
        .title('Товары')
        .include(Goods)
        .field('sale', (field) => field.reference(Sale).title('Продажа').required()))
    .listTableParts(['goods'])
    .policy(refundGoods)
    // Пометка удаления не зависит от состава строк: правило состава её не вызывает. Проведённый возврат помечают на удаление только после отмены проведения.
    .policy(preventPostedDocumentDeletion())
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе табличные части оказались бы над ней.
    .form((form) => form
        .group('Возврат', ['number', 'date', 'shift'])
        .group('На основании', ['bases'])
        .group('Товары', ['goods'])
        .hide('posted'))
    // Движение записывается на продажу, а не на строку: предел действует на сумму по продаже.
    .posting((record) => Effect.gen(function* () {
        const returned = new Map<string, number>();
        for (const line of record.goods) returned.set(line.sale, (returned.get(line.sale) ?? 0) + line.total);
        const database = yield* Database;
        const rows = [];
        for (const [saleGuid, total] of returned) {
            const sale = yield* database.get(query(Sale).select({
                columns: ['shift'],
                where: [{ column: 'guid', operator: '=', value: saleGuid }],
                limit: 1,
            }));
            if (sale === undefined) return yield* new DataPolicyError({ message: 'Продажа из строки возврата не найдена' });
            // Вычитание из нуля, а не унарный минус: для нулевой суммы он дал бы отрицательный ноль.
            rows.push({ sale: saleGuid, shift: sale.shift, amount: 0 - total });
        }
        return [movements(Sales, rows)];
    }));
