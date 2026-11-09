/**
 * Купоны: акции, по которым покупатель получает скидку на товар по бумажному купону с номером.
 * Запись описывает акцию: процент скидки, сколько купонов выпущено и срок действия. Применённый
 * купон хранит строка товара продажи: ссылку на акцию, номер купона и копию процента.
 * Правила применения описаны в разделе «Правила учёта», подраздел «Купон».
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { catalog, type LookupInput, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { normalizeSearchText } from '../../server/ui/value-format.js';
import { checkCouponActive, checkCouponUsage, couponActive, couponNumberKey, couponUsage, today, validCouponPercentage } from '../coupons.js';

/**
 * Описание без политики, подбора и действия: они ссылаются на сам справочник, и ссылка на `Coupons`
 * из его же объявления не дала бы вывести тип.
 */
const coupons = catalog('coupons')
    .title('Купоны')
    .field('percentage', (field) => field.number().title('Процент').minimum(0).maximum(100).required())
    .field('quantity', (field) => field.number().title('Количество').integer().minimum(1).required())
    .field('validFrom', (field) => field.date().title('Действует с').required())
    .field('validTo', (field) => field.date().title('Действует по').required())
    // Процент рядом с названием: при выборе купона размер скидки виден сразу.
    .presentation([{ field: 'name' }, { text: ' ' }, { field: 'percentage', format: 'number' }, { text: ' %' }]);

type CouponRecord = RecordOf<typeof coupons>;

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/**
 * Правила акции: процент больше нуля и не точнее сотых, срок не пуст, а количество не меньше
 * уже применённых купонов. Иначе уменьшение количества сделало бы проведённые продажи
 * нарушающими правило, которое их пропустило.
 */
const couponRulesPolicy: Policy<CouponRecord> = {
    name: 'coupon-rules',
    save: ({ proposedRecord }) => Effect.gen(function* () {
        if (!validCouponPercentage(proposedRecord.percentage)) return yield* rejected('Процент купона должен быть больше нуля, не больше 100 и с точностью до сотых');
        if (proposedRecord.validFrom > proposedRecord.validTo) return yield* rejected('Начало срока действия купона позже его окончания');
        const usage = yield* couponUsage(proposedRecord.guid, null);
        if (proposedRecord.quantity < usage.used) return yield* rejected(`Купонов уже применено ${usage.used}: количество не может быть меньше`);
    }),
};

/**
 * Подбор купона в продаже: только акции, которые действуют сегодня, не помечены на удаление
 * и не исчерпаны. Истёкшую акцию выбрать нельзя, а политика продажи дополнительно проверяет
 * срок по дате продажи. Строка поиска делится на слова, каждое должно быть в названии
 * или проценте; слова ищутся на сервере по той же причине, что и в подборе продаж.
 */
const searchCoupons = ({ search, pageSize, offset }: LookupInput) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const day = today();
    const rows = yield* database.all(query(coupons).select({
        columns: ['guid', 'name', 'percentage', 'quantity', 'validFrom', 'validTo'],
        where: [{ column: 'deletedAt', operator: '=', value: null }],
        orderBy: [{ column: 'name', direction: 'ASC' }],
    }));
    const available: Array<{ guid: string; name: string; percentage: number; validTo: string; remaining: number }> = [];
    for (const row of rows) {
        if (!couponActive({ ...row, deletedAt: null }, day)) continue;
        const remaining = row.quantity - (yield* couponUsage(row.guid, null)).used;
        if (remaining > 0) available.push({ guid: row.guid, name: row.name, percentage: row.percentage, validTo: row.validTo, remaining });
    }
    const words = normalizeSearchText('string', search).split(/\s+/u).filter((word) => word !== '');
    const matched = available.filter((row) => {
        const text = normalizeSearchText('string', `${row.name} ${row.percentage}`);
        return words.every((word) => text.includes(word));
    });
    return { total: matched.length, rows: matched.slice(offset, offset + pageSize) };
});

/**
 * Действие «Применить купон» вызывает окно купона на форме продажи, пока продажа ещё не записана.
 * Оно проверяет те же правила, что политика продажи, и возвращает процент акции: форма копирует
 * его в строку товара. Номер строки товара сервер не читает: его выбирают в окне, а проверку
 * строки выполнит запись продажи. Продажа передаётся, чтобы её собственные проведённые
 * применения не считались чужими при изменении проведённой продажи.
 */
export const Coupons = coupons
    .policy(couponRulesPolicy)
    .lookup((lookup) => lookup
        .column('name', (field) => field.string().title('Акция').required())
        .column('percentage', (field) => field.number().title('Процент').required())
        .column('validTo', (field) => field.date().title('Действует по').required())
        .column('remaining', (field) => field.number().title('Осталось').required())
        .search(searchCoupons))
    .form((form) => form.creation('dialog'))
    .action('application', (action) => action
        .title('Применить купон')
        // Окно открывает форма продажи: кнопка на форме справочника не нужна.
        .placement('hidden')
        .input((input) => input
            .field('coupon', (field) => field.reference(coupons).title('Акция').required().width('free'))
            .field('number', (field) => field.string().title('Номер купона').required().maximumLength(50))
            .field('goodsLine', (field) => field.number().title('Товар').integer().minimum(1).required())
            .field('date', (field) => field.dateTime().title('Дата продажи'))
            .field('sale', (field) => field.reference((): ObjectTarget => ({ kind: 'document', name: 'sale' })).title('Продажа')))
        .handle((input) => Effect.gen(function* () {
            // Необязательные поля, не переданные в запросе, приходят в действие как `undefined`.
            const terms = yield* checkCouponActive(input.coupon, input.date ?? new Date().toISOString());
            yield* checkCouponUsage(terms, [couponNumberKey(input.number)], input.sale ?? null);
            return { coupon: terms.guid, number: couponNumberKey(input.number), percentage: terms.percentage, goodsLine: input.goodsLine };
        })));
