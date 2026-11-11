/**
 * Купоны: акции, по которым покупатель получает скидку на товар по бумажному купону с номером.
 * Запись описывает акцию: вид и размер скидки, сколько купонов выпущено и срок действия. Купон
 * вида «Процент» уменьшает итог товара на процент, купон вида «Сумма» на номинал. Применённый
 * купон хранит строка товара продажи: ссылку на акцию, номер купона и копию процента или номинала.
 * Правила применения описаны в разделе «Правила учёта», подраздел «Купон».
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { catalog, type LookupInput, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { normalizeSearchText } from '../../server/ui/value-format.js';
import { amountCoupon, checkCouponActive, couponApplications, checkCouponUsage, couponActive, couponKinds, couponNumberKey, couponSizeText, couponUsage, percentageCoupon, today, validCouponPercentage } from '../coupons.js';

/**
 * Описание без политики, подбора и действия: они ссылаются на сам справочник, и ссылка на `Coupons`
 * из его же объявления не дала бы вывести тип.
 */
const coupons = catalog('coupons')
    .title('Купоны')
    // Вид выбирают до размера: от него зависит, какое из двух следующих полей видно на форме.
    .field('kind', (field) => field.string().title('Вид').choices(couponKinds).initial(percentageCoupon).required())
    // Процент и номинал необязательны в описании: обязательность по виду проверяет `couponRulesPolicy`.
    .field('percentage', (field) => field.number().title('Процент').minimum(0).maximum(100))
    .field('denomination', (field) => field.money().title('Номинал').minimum(0))
    .field('quantity', (field) => field.number().title('Количество').integer().minimum(1).required())
    .field('validFrom', (field) => field.date().title('Действует с').required())
    .field('validTo', (field) => field.date().title('Действует по').required())
    // Размер скидки рядом с названием: при выборе купона он виден сразу. Заполнено только поле
    // своего вида, а суффикс пустого поля не выводится, поэтому получается «Осень 10 %» или «Подарок 500,00 ₽».
    .presentation([{ field: 'name' }, { text: ' ' }, { field: 'percentage', format: 'number', suffix: ' %' }, { field: 'denomination', suffix: ' ₽' }]);

type CouponRecord = RecordOf<typeof coupons>;

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/**
 * Правила акции: заполнено только поле размера своего вида, процент больше нуля и не точнее сотых,
 * номинал больше нуля, а срок не пуст. Поле чужого вида отклоняется, а не очищается молча: форма
 * купона очищает его сама перед записью, и заполненным его может прислать только запрос мимо формы.
 *
 * После первого применения акция закрепляется: вид, процент и номинал не меняются, а количество
 * только растёт. Строки проведённых продаж хранят копию размера, и акция с другим размером
 * разошлась бы с ними: отчёт по акции и повторная запись продажи видели бы разные условия.
 * Уменьшение количества сделало бы проведённые продажи нарушающими правило, которое их пропустило,
 * а увеличение безопасно и нужно, когда магазин допечатывает купоны. Применения считаются
 * по регистру «Применённые купоны», то есть только в проведённых продажах: черновик хранит
 * свою копию размера и при проведении условия акции повторно не сверяет.
 */
const couponRulesPolicy: Policy<CouponRecord> = {
    name: 'coupon-rules',
    save: ({ existingRecord, proposedRecord }) => Effect.gen(function* () {
        if (proposedRecord.kind === amountCoupon) {
            if (proposedRecord.percentage !== null) return yield* rejected('У купона вида «Сумма» процент не заполняется');
            if (proposedRecord.denomination === null || proposedRecord.denomination <= 0) return yield* rejected('Номинал купона должен быть больше нуля');
        } else {
            if (proposedRecord.denomination !== null) return yield* rejected('У купона вида «Процент» номинал не заполняется');
            if (proposedRecord.percentage === null || !validCouponPercentage(proposedRecord.percentage)) return yield* rejected('Процент купона должен быть больше нуля, не больше 100 и с точностью до сотых');
        }
        if (proposedRecord.validFrom > proposedRecord.validTo) return yield* rejected('Начало срока действия купона позже его окончания');
        if (existingRecord === null) return;
        const usage = yield* couponUsage(proposedRecord.guid, null);
        if (usage.used === 0) return;
        const applied = `Купонов «${existingRecord.name}» уже применено ${usage.used}`;
        if (proposedRecord.kind !== existingRecord.kind || proposedRecord.percentage !== existingRecord.percentage || proposedRecord.denomination !== existingRecord.denomination) {
            return yield* rejected(`${applied}: вид и размер скидки изменить нельзя`);
        }
        if (proposedRecord.quantity < existingRecord.quantity) return yield* rejected(`${applied}: количество можно только увеличить`);
    }),
};

/**
 * Подбор купона в продаже: только акции, которые действуют сегодня, не помечены на удаление
 * и не исчерпаны. Истёкшую акцию выбрать нельзя, а политика продажи дополнительно проверяет
 * срок по дате продажи. Строка поиска делится на слова, каждое должно быть в названии
 * или размере скидки («10 %», «500,00 ₽»); слова ищутся на сервере по той же причине, что и в подборе продаж.
 */
const searchCoupons = ({ search, pageSize, offset }: LookupInput) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const day = today();
    const rows = yield* database.all(query(coupons).select({
        columns: ['guid', 'name', 'kind', 'percentage', 'denomination', 'quantity', 'validFrom', 'validTo'],
        where: [{ column: 'deletedAt', operator: '=', value: null }],
        orderBy: [{ column: 'name', direction: 'ASC' }],
    }));
    const available: Array<{ guid: string; name: string; size: string; validTo: string; remaining: number }> = [];
    for (const row of rows) {
        if (!couponActive({ ...row, deletedAt: null }, day)) continue;
        const remaining = row.quantity - (yield* couponUsage(row.guid, null)).used;
        if (remaining > 0) available.push({ guid: row.guid, name: row.name, size: couponSizeText(row), validTo: row.validTo, remaining });
    }
    const words = normalizeSearchText('string', search).split(/\s+/u).filter((word) => word !== '');
    const matched = available.filter((row) => {
        const text = normalizeSearchText('string', `${row.name} ${row.size}`);
        return words.every((word) => text.includes(word));
    });
    return { total: matched.length, rows: matched.slice(offset, offset + pageSize) };
});

/**
 * Действие «Применить купон» вызывает окно купона на форме продажи, пока продажа ещё не записана.
 * Оно проверяет те же правила, что политика продажи, и возвращает вид и размер акции: форма копирует
 * процент или номинал в строку товара. Номер строки товара сервер не читает: его выбирают в окне, а проверку
 * строки выполнит запись продажи. Продажа передаётся, чтобы её собственные проведённые
 * применения не считались чужими при изменении проведённой продажи.
 */
export const Coupons = coupons
    .policy(couponRulesPolicy)
    .lookup((lookup) => lookup
        .column('name', (field) => field.string().title('Акция').required())
        // Одна колонка скидки для обоих видов: «10 %» или «500,00 ₽».
        .column('size', (field) => field.string().title('Скидка').required())
        .column('validTo', (field) => field.date().title('Действует по').required())
        .column('remaining', (field) => field.number().title('Осталось').required())
        .search(searchCoupons))
    .form((form) => form.creation('dialog'))
    // Блок «Применения» на форме купона: число применённых и оставшихся купонов и список применений.
    .function('applications', (builder) => builder
        .title('Применения купона')
        .input((input) => input
            .field('coupon', (field) => field.reference(coupons).title('Акция').required()))
        .handle((input) => couponApplications(input.coupon)))
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
            return { coupon: terms.guid, number: couponNumberKey(input.number), kind: terms.kind, percentage: terms.percentage, denomination: terms.denomination, goodsLine: input.goodsLine };
        })));
