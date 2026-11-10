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
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { movements, objectReference, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { initialPayments } from '../installment-initial-payments.js';
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
    const database = yield* ReadonlyDatabase;
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
        const database = yield* ReadonlyDatabase;
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
    // Ссылка продолжает обозначать рассрочку, но обычный переход открывает связанную продажу.
    // Проверка null сохраняет открытие старых данных без связи; Shift выбирает оригинал на платформе.
    .opening((record) => record.sale == null ? null : objectReference(Sale, record.sale))
    .policy(oneInstallmentPerSalePolicy)
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    .form((form) => form
        .group('Рассрочка', ['number', 'date', 'sale', 'type', 'rate', 'shift', 'person', 'responsibleEmployee', 'amount'])
        .group('Взносы', ['payments', 'balance'])
        .hide('closedAt')
        .hide('posted'));

/**
 * Взнос по рассрочке в ленте рабочего места продавца. `guid` и `number` принадлежат рассрочке:
 * взнос не документ, а строка её табличной части, поэтому строку отличает `line`. `sales` содержит
 * продажу рассрочки, чтобы поиск находил взнос и по её номеру.
 */
export interface InstallmentPaymentFeedRow {
    readonly kind: 'payment';
    readonly guid: string;
    readonly line: number;
    readonly number: string;
    readonly date: string;
    readonly method: string;
    readonly holder: string | null;
    readonly amount: number;
    readonly sales: ReadonlyArray<{ readonly guid: string; readonly number: string; readonly date: string }>;
}

/**
 * Первоначальные взносы продаж (`initialPayments`): сумма по каждой продаже из `sales`. Лента
 * продавца прибавляет их к сумме продажи вместо оплаты «Рассрочка», как сводка за период: долг
 * рассрочки денег не приносит, а первоначальный взнос пришёл в день продажи. Учитываются
 * проведённые рассрочки без пометки удаления; продажа без них в результат не попадает.
 */
export const readInitialPayments = (sales: ReadonlyArray<string>) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const result = new Map<string, number>();
    if (sales.length === 0) return result;
    const installments = yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'date', 'type', 'sale'],
        where: [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }, { column: 'sale', operator: 'IN', value: [...new Set(sales)] }],
    }));
    if (installments.length === 0) return result;
    // Взносы читаются в порядке строк: правило первоначального взноса при равных моментах берёт первый.
    const payments = yield* database.all(query(SaleInstallment).tablePart('payments').select({
        columns: ['ownerGuid', 'lineNumber', 'date', 'amount'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: installments.map((row) => row.guid) }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    for (const installment of installments) {
        const initial = initialPayments(installment, payments.filter((payment) => payment.ownerGuid === installment.guid));
        const amount = [...initial].reduce((sum, payment) => sum + payment.amount, 0);
        result.set(installment.sale, (result.get(installment.sale) ?? 0) + amount);
    }
    return result;
});

/**
 * Взносы проведённых рассрочек для ленты продавца (`sellerFeed` возврата), новые сверху.
 * Первоначальный взнос (`initialPayments`) строки не получает: его деньги уже показывает строка
 * продажи. Поэтому читаются все взносы рассрочки, а не только последние: без ранних взносов нельзя
 * определить, какой из них первоначальный. Рассрочек немного, и ограничение `limit` применяется
 * после отбора.
 */
export const readInstallmentPaymentFeed = (limit: number | null) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const installments = yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'number', 'date', 'type', 'sale', 'person'],
        where: [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }],
    }));
    if (installments.length === 0) return { rows: [], total: 0 };
    // Взносы читаются в порядке строк: правило первоначального взноса при равных моментах берёт первый.
    const payments = yield* database.all(query(SaleInstallment).tablePart('payments').select({
        columns: ['ownerGuid', 'lineNumber', 'date', 'method', 'amount'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: installments.map((row) => row.guid) }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const saleGuids = [...new Set(installments.map((row) => row.sale))];
    const sales = yield* database.all(query(Sale).select({ columns: ['guid', 'number', 'date'], where: [{ column: 'guid', operator: 'IN', value: saleGuids }] }));
    const personGuids = [...new Set(installments.flatMap((row) => row.person === null ? [] : [row.person]))];
    const persons = personGuids.length === 0 ? [] : yield* database.all(query(PhysicalPersons).select({
        columns: ['guid', 'name'],
        where: [{ column: 'guid', operator: 'IN', value: personGuids }],
    }));
    const saleOf = new Map(sales.map((row) => [row.guid, row]));
    const holderOf = new Map(persons.map((row) => [row.guid, row.name]));
    const rows = installments.flatMap((installment) => {
        const own = payments.filter((payment) => payment.ownerGuid === installment.guid);
        const initial = initialPayments(installment, own);
        const sale = saleOf.get(installment.sale);
        return own.filter((payment) => !initial.has(payment)).map((payment): InstallmentPaymentFeedRow => ({
            kind: 'payment', guid: installment.guid, line: payment.lineNumber, number: installment.number, date: payment.date,
            method: payment.method, holder: installment.person === null ? null : holderOf.get(installment.person) ?? null, amount: payment.amount,
            sales: sale === undefined ? [] : [{ guid: sale.guid, number: sale.number, date: sale.date }],
        }));
    });
    // Даты сравниваются моментами: строки хранятся с часовым поясом клиента.
    rows.sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime());
    return { rows: limit === null ? rows : rows.slice(0, limit), total: rows.length };
});
