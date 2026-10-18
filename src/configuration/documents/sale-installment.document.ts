/**
 * Рассрочка по продаже: часть оплаты продажи, которую покупатель вносит взносами. Оформляется
 * на сумму строк оплаты продажи со способом «Рассрочка» действиями продажи «Продать с рассрочкой»
 * и «Внести изменения». У продажи не больше одной рассрочки.
 * Товаров у документа нет: они записаны в продаже и входят в её сумму, а сумма рассрочки вводится.
 *
 * Отдельный документ, а не поля рассрочки в строке оплаты: так продажа не усложняется.
 *
 * Поля шапки, взносы, политика, проведение и действия «Внести» и «Закрыть» заданы общим описанием
 * рассрочек в `installments.ts`. Изменяют рассрочку вместе с продажей и отменяют её действия
 * продажи «Внести изменения» и «Отмена продажи».
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { Database } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { movements, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { installmentDocument } from '../installments.js';
import { numberAndDate } from '../money.js';
import { installmentMethod } from '../payments.js';
import { UnarrangedInstallments } from '../registers/unarranged-installments.register.js';
import { Sale } from './sale.document.js';

/**
 * Описание без политики оформления и формы. Политика читает таблицу самого документа, а ссылка
 * на `SaleInstallment` из его же объявления не дала бы вывести тип.
 *
 * Проведённая рассрочка записывает свою сумму с минусом в регистр «Неоформленные рассрочки»:
 * так итог по продаже показывает сумму, на которую рассрочка ещё не оформлена. Превысить сумму
 * строк оплаты «Рассрочка» не даёт ограничение этого регистра, а не политика документа.
 */
const saleInstallment = installmentDocument('saleInstallment', 'Рассрочка по продаже', (base) => base
    .field('sale', (field) => field.reference(Sale).title('Продажа').required())
    .field('amount', (field) => field.money().title('Сумма').minimum(1).required()),
// Вычитание из нуля, а не унарный минус: так сумма записана в том же виде, что у остальных движений с минусом.
(record) => [movements(UnarrangedInstallments, [{ sale: record.sale, amount: 0 - record.amount }])],
// Основание рассрочки — продажа: закрытая рассрочка помечается на удаление, когда продажу отменили.
(record) => Effect.gen(function* () {
    const database = yield* Database;
    const sale = yield* database.get(query(Sale).select({ columns: ['deletedAt'], where: [{ column: 'guid', operator: '=', value: record.sale }], limit: 1 }));
    return (sale?.deletedAt ?? null) !== null;
}));

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/**
 * Оформление рассрочки по продаже (раздел «Правила учёта»): новую рассрочку или рассрочку,
 * переносимую на другую продажу, принимает только продажа без пометки удаления, с оплатой
 * способом «Рассрочка» и без другой рассрочки. Вторая рассрочка разделила бы одну оплату
 * на несколько долгов: изменение суммы пришлось бы распределять между ними, а закрытую рассрочку
 * «Внести изменения» и так открывает заново. Поэтому прирост оплаты «Рассрочка» получает
 * имеющаяся рассрочка.
 *
 * Рассрочка с пометкой удаления продажу не занимает: её снимает отмена продажи вместе с самой
 * продажей. Запись имеющейся рассрочки той же продажи не проверяется: продажи, у которых
 * рассрочек несколько, оформлены до этого правила, и их рассрочки по-прежнему меняются.
 */
const oneInstallmentPerSalePolicy: Policy<RecordOf<typeof saleInstallment>> = {
    name: 'one-installment-per-sale',
    save: ({ existingRecord, proposedRecord }) => Effect.gen(function* () {
        if (existingRecord !== null && existingRecord.sale === proposedRecord.sale) return;
        const database = yield* Database;
        const sale = yield* database.get(query(Sale).select({
            columns: ['number', 'date', 'deletedAt'],
            where: [{ column: 'guid', operator: '=', value: proposedRecord.sale }],
            limit: 1,
        }));
        if (sale === undefined) return yield* rejected('Продажи рассрочки нет в базе');
        const title = `Продажа ${numberAndDate(sale)}`;
        if (sale.deletedAt !== null) return yield* rejected(`${title} помечена на удаление: рассрочку по ней не оформить`);
        const line = yield* database.get(query(Sale).tablePart('payments').select({
            columns: ['amount'],
            where: [
                { column: 'ownerGuid', operator: '=', value: proposedRecord.sale },
                { column: 'method', operator: '=', value: installmentMethod },
            ],
            limit: 1,
        }));
        if (line === undefined || line.amount <= 0) return yield* rejected(`${title}: в оплате нет способа «${installmentMethod}», рассрочка по ней не нужна`);
        const other = yield* database.get(query(saleInstallment).select({
            columns: ['number', 'date'],
            where: [
                { column: 'sale', operator: '=', value: proposedRecord.sale },
                { column: 'deletedAt', operator: '=', value: null },
                // Без исключения самой записи перенос рассрочки обратно на её продажу был бы отклонён.
                { column: 'guid', operator: '!=', value: proposedRecord.guid },
            ],
            limit: 1,
        }));
        if (other !== undefined) {
            return yield* rejected(`${title} уже оформлена рассрочкой ${numberAndDate(other)}: вторая рассрочка не оформляется. Измените имеющуюся кнопкой «Внести изменения» продажи`);
        }
    }),
};

export const SaleInstallment = saleInstallment
    .policy(oneInstallmentPerSalePolicy)
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    .form((form) => form
        .group('Рассрочка', ['number', 'date', 'sale', 'type', 'rate', 'shift', 'person', 'responsibleEmployee', 'amount'])
        .group('Взносы', ['payments', 'balance'])
        .hide('closedAt')
        .hide('posted'));
