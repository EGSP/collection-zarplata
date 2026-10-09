/**
 * Возврат: товары, которые покупатель вернул по продажам. Строка товара ссылается на продажу.
 * Проведённый возврат уменьшает сумму, которую ещё можно вернуть по его продажам; саму продажу
 * возврат не изменяет.
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { selectTyped } from '../../server/data/typed-select.js';
import { Database } from '../../server/database/database.effect.js';
import { select } from '../../server/database/sql.builder.js';
import { document, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { OpenShift } from '../form-elements/open-shift.form-element.js';
import { RefundSales } from '../form-elements/refund-sales.form-element.js';
import { Goods } from '../goods.js';
import { numberAndDate, rubles } from '../money.js';
import { Sale } from './sale.document.js';
import { Shift } from './shift.document.js';

/**
 * Описание без политики. Политика читает таблицу самого документа, а ссылка на `Refund`
 * из его же объявления не дала бы вывести тип.
 */
const refund = document('refund')
    .title('Возврат')
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    .tablePart('bases', (part) => part
        .title('На основании')
        .field('sale', (field) => field.reference(Sale).title('Продажа').required()))
    .tablePart('goods', (part) => part
        .title('Товары')
        .include(Goods)
        .field('sale', (field) => field.reference(Sale).title('Продажа').required()))
    .listTableParts(['goods']);

type RefundRecord = RecordOf<typeof refund>;

const rejected = (message: string) => new DataPolicyError({ message });

/**
 * Предел возврата (раздел «Правила учёта»): по каждой продаже сумма итогов строк всех проведённых
 * возвратов вместе с проверяемым не превышает суммы продажи. Ограничение действует на сумму,
 * а не на отдельные товары.
 *
 * Транзакции выполняются по очереди, поэтому два возврата по одной продаже не пройдут проверку
 * одновременно: второй увидит первый уже проведённым.
 */
const withinSaleAmounts = (document: RefundRecord) => Effect.gen(function* () {
    const requested = new Map<string, number>();
    for (const line of document.goods) requested.set(line.sale, (requested.get(line.sale) ?? 0) + line.total);
    if (requested.size === 0) return;
    const database = yield* Database;
    const posted = new Set((yield* database.all(selectTyped(refund, {
        columns: ['guid'],
        where: [{ column: 'posted', operator: '=', value: true }],
    }))).map((other) => other.guid));
    // Сам документ уже может быть проведён: его прежние строки заменяются проверяемыми.
    posted.delete(document.guid);
    for (const [saleGuid, amount] of requested) {
        const sale = yield* database.get(selectTyped(Sale, {
            columns: ['number', 'date', 'amount'],
            where: [{ column: 'guid', operator: '=', value: saleGuid }],
            limit: 1,
        }));
        if (sale === undefined) return yield* rejected('Продажа из строки возврата не найдена');
        // Типизированная выборка читает только шапку, а строки товаров лежат в таблице части.
        const lines = yield* database.all<{ ownerGuid: string; total: number }>(select('document_refund_goods', {
            columns: ['ownerGuid', 'total'],
            where: [{ column: 'sale', operator: '=', value: saleGuid }],
        }));
        const returned = lines.filter((line) => posted.has(line.ownerGuid)).reduce((sum, line) => sum + line.total, 0);
        const available = sale.amount - returned;
        if (amount > available) {
            return yield* rejected(`По продаже ${numberAndDate(sale)} можно вернуть ещё ${rubles(available)}, а в возврате ${rubles(amount)}`);
        }
    }
});

/**
 * Предел проверяется при проведении. Запись проведённого возврата проводит его заново без
 * политики проведения, поэтому такая запись проверяется здесь же; непроведённый возврат
 * записывается без проверки, как черновик.
 */
const refundLimit: Policy<RefundRecord> = {
    name: 'refund-limit',
    save: ({ existingRecord, proposedRecord }) => existingRecord?.posted === true ? withinSaleAmounts(proposedRecord) : Effect.void,
    post: ({ document }) => withinSaleAmounts(document),
};

/**
 * Товары в возврат добавляет элемент `RefundSales`: он показывает товары продаж из части
 * «На основании», и нажатие на товар копирует его в товары возврата со ссылкой на продажу.
 */
export const Refund = refund
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе табличные части оказались бы над ней.
    .form((form) => form
        .group('Возврат', ['number', 'date', 'shift', OpenShift])
        .group('На основании', ['bases', RefundSales])
        .group('Товары', ['goods'])
        .hide('posted'))
    .policy(refundLimit);
