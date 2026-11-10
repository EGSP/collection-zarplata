/**
 * Общие правила сертификатов в продаже и возврате (раздел «Правила учёта», подраздел «Сертификат»):
 * остаток сертификата без движений проверяемого документа и проверка строк оплаты сертификатами.
 * Их используют политика продажи и план расчётов возврата (`refund-plan.ts`).
 *
 * Сертификат и регистр импортируются билдерами: ни тот, ни другой не ссылаются на продажу
 * и возврат, поэтому кольца импортов нет.
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../server/data/data.errors.js';
import { query } from '../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../server/database/database.effect.js';
import { Certificate } from './documents/certificate.document.js';
import { numberAndDate, rubles } from './money.js';
import { CertificateBalances } from './registers/certificate-balances.register.js';

/** Регистратор движения: документ, движения которого не учитываются в остатке. */
export interface ExcludedRecorder {
    readonly document: string;
    readonly guid: string;
}

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/**
 * Остаток сертификата без движений документа `excluded`: столько этот документ может списать.
 * Так проверяется новая запись проведённой продажи до того, как проведение перепишет её движения:
 * её прежнее списание возвращается в остаток.
 */
export const certificateBalance = (certificate: string, excluded: ExcludedRecorder | null) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const rows = yield* database.all(query(CertificateBalances).select({
        columns: ['amount'],
        where: [
            { column: 'certificate', operator: '=', value: certificate },
            // Регистратор сравнивается значением `{ document, guid }`, как его записывает проведение.
            ...excluded === null ? [] : [{ column: 'recorder', operator: '!=', value: excluded } as const],
        ],
    }));
    return rows.reduce((total, row) => total + row.amount, 0);
});

/** Сертификат в тексте отказа: номер и дата выдачи, как в его представлении. */
export const certificateTitle = (certificate: { readonly number: string; readonly date: string }) => `Сертификат ${numberAndDate(certificate)}`;

/** Строка оплаты сертификатом: сертификат и списываемая сумма. */
export interface CertificateLine {
    readonly certificate: string;
    readonly amount: number;
}

/**
 * Проверяет оплату продажи `sale` сертификатами (раздел «Правила учёта», подраздел «Сертификат»).
 * Каждый сертификат указан одной строкой, проведён и не помечен на удаление, а сумма строки
 * не больше его остатка без движений этой продажи.
 *
 * То же предел проверяет ограничение регистра «Остатки сертификатов» при проведении, но его отказ
 * не назвал бы строку продажи. Проверка нужна и при записи черновика: продавец узнаёт
 * о нехватке остатка, пока покупатель рядом.
 */
export const checkSaleCertificates = (lines: ReadonlyArray<CertificateLine>, sale: string) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const seen = new Set<string>();
    for (const [index, line] of lines.entries()) {
        const place = `Строка сертификата ${index + 1}`;
        if (seen.has(line.certificate)) return yield* rejected(`${place}: сертификат уже указан в продаже. Каждый сертификат указывается одной строкой`);
        seen.add(line.certificate);
        const certificate = yield* database.get(query(Certificate).select({
            columns: ['number', 'date', 'posted', 'deletedAt'],
            where: [{ column: 'guid', operator: '=', value: line.certificate }],
            limit: 1,
        }));
        if (certificate === undefined) return yield* rejected(`${place}: сертификат не найден`);
        const title = certificateTitle(certificate);
        if (certificate.deletedAt !== null) return yield* rejected(`${place}: ${title} помечен на удаление`);
        if (!certificate.posted) return yield* rejected(`${place}: ${title} не проведён, оплатить им нельзя`);
        const balance = yield* certificateBalance(line.certificate, { document: 'sale', guid: sale });
        if (line.amount > balance) return yield* rejected(`${place}: сумма ${rubles(line.amount)} больше остатка ${rubles(balance)} у сертификата ${numberAndDate(certificate)}`);
    }
});
