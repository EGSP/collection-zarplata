/**
 * Общие правила купонов (раздел «Правила учёта», подраздел «Купон»): срок действия, число
 * применений акции и уникальность номера купона. Их проверяют политика продажи при записи
 * и проведении и действие справочника «Применить купон», которое форма продажи вызывает до записи.
 *
 * Справочник и регистр читаются по описанию из метаданных, а не по билдерам: справочник импортирует
 * этот модуль ради своего действия, регистр ссылается на продажу, а продажа на справочник.
 * Импорт билдеров отсюда замкнул бы файлы в кольцо.
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../server/data/data.errors.js';
import { query } from '../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../server/database/database.effect.js';
import { Metadata, type ObjectKind } from '../server/metadata/index.js';
import { dayOf } from './policies/closed-period.js';

/** Купон акции в том виде, в каком его читают правила. */
export interface CouponTerms {
    readonly guid: string;
    readonly name: string;
    readonly percentage: number;
    readonly quantity: number;
    readonly validFrom: string;
    readonly validTo: string;
    readonly deletedAt: string | null;
}

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/** Описание объекта конфигурации по имени: модуль не импортирует билдеры, см. описание модуля. */
const described = (kind: ObjectKind, name: string, title: string) => Effect.gen(function* () {
    const metadata = yield* Metadata;
    const description = metadata.find(kind, name);
    if (description === undefined) return yield* Effect.die(new Error(`В конфигурации нет объекта «${title}»`));
    return description;
});

/**
 * Номер купона для сравнения: без пробелов по краям и в верхнем регистре. Продавец переписывает
 * номер с бумажного купона, и «a-15» и «A-15 » означают один купон.
 */
export const couponNumberKey = (value: string) => value.trim().toUpperCase();

/** Купон по ссылке; `null`, если такой записи нет. */
export const couponTerms = (coupon: string) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const row = yield* database.get(query(yield* described('catalog', 'coupons', 'Купоны')).select({
        columns: ['guid', 'name', 'percentage', 'quantity', 'validFrom', 'validTo', 'deletedAt'],
        where: [{ column: 'guid', operator: '=', value: coupon }],
        limit: 1,
    }));
    return row === undefined ? null : row as unknown as CouponTerms;
});

/** Сегодняшний день в том же виде, что и день документа (`dayOf`): по нему подбор скрывает истёкшие купоны. */
export const today = () => dayOf(new Date().toISOString());

/** Действует ли купон в день `day`: границы срока входят в него. */
export const couponActive = (terms: CouponTerms, day: string) => terms.validFrom <= day && day <= terms.validTo;

/** Срок действия купона словами для текста отказа. */
const period = (terms: CouponTerms) => `с ${terms.validFrom.split('-').reverse().join('.')} по ${terms.validTo.split('-').reverse().join('.')}`;

/**
 * Проверяет, что купон можно применить в день продажи `date`: запись есть, не помечена на удаление,
 * и день входит в срок действия. Проверка нужна только новым и изменённым строкам: купон,
 * применённый в срок, не становится недействительным, когда срок проходит.
 */
export const checkCouponActive = (coupon: string, date: string) => Effect.gen(function* () {
    const terms = yield* couponTerms(coupon);
    if (terms === null) return yield* rejected('Купон не найден');
    if (terms.deletedAt !== null) return yield* rejected(`Купон «${terms.name}» помечен на удаление`);
    if (!couponActive(terms, dayOf(date))) return yield* rejected(`Купон «${terms.name}» действует ${period(terms)}: в день продажи его применить нельзя`);
    return terms;
});

/**
 * Применения купона другими продажами: номера и их число. Движения продажи `sale` исключаются:
 * так проверяется её новая запись до того, как проведение перепишет её движения.
 */
export const couponUsage = (coupon: string, sale: string | null) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const rows = yield* database.all(query(yield* described('register', 'appliedCoupons', 'Применённые купоны')).select({
        columns: ['number', 'count'],
        where: [
            { column: 'coupon', operator: '=', value: coupon },
            // Регистратор сравнивается значением `{ document, guid }`, как его записывает проведение.
            ...sale === null ? [] : [{ column: 'recorder', operator: '!=', value: { document: 'sale', guid: sale } } as const],
        ],
    }));
    const numbers = new Map<string, number>();
    for (const row of rows) numbers.set(String(row['number']), (numbers.get(String(row['number'])) ?? 0) + Number(row['count']));
    const used = [...numbers.values()].reduce((total, count) => total + count, 0);
    return { numbers, used };
});

/**
 * Проверяет применения купона продажей `sale`: номера `numbers` этой продажи не заняты другими
 * продажами, а вместе с ними применений акции не больше её количества. Номер уникален в пределах
 * акции: у другой акции тот же номер означает другой купон.
 */
export const checkCouponUsage = (terms: CouponTerms, numbers: ReadonlyArray<string>, sale: string | null) => Effect.gen(function* () {
    const usage = yield* couponUsage(terms.guid, sale);
    for (const number of numbers) {
        if ((usage.numbers.get(couponNumberKey(number)) ?? 0) > 0) return yield* rejected(`Купон «${terms.name}» с номером ${number} уже применён в другой продаже`);
    }
    if (usage.used + numbers.length > terms.quantity) {
        const left = Math.max(0, terms.quantity - usage.used);
        return yield* rejected(`Купонов «${terms.name}» выпущено ${terms.quantity}, применить можно ещё ${left}`);
    }
});

/** Процент купона: больше нуля, не больше 100 и не точнее сотых долей. */
export const validCouponPercentage = (value: number) => value > 0 && value <= 100 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6;
