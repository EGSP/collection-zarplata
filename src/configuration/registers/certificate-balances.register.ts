/**
 * Регистр «Остатки сертификатов»: сколько денег осталось на каждом сертификате. Проведённый
 * сертификат записывает свой номинал с плюсом и обмен на деньги с минусом. Оплата продажи
 * сертификатом списывает сумму с минусом, возврат по такой продаже пополняет сертификат.
 * Итог по сертификату равен его остатку; состояние сертификата («Действует», «Израсходован»,
 * «Обменян на деньги») выводится из этих движений и в документе не хранится.
 *
 * Деньги за сертификаты магазин хранит отдельно от кассы, поэтому ни выдача, ни обмен не пишут
 * движений в «Поступления денег» (раздел «Правила учёта», подраздел «Сертификат»).
 */
import { Effect } from 'effect';
import { query } from '../../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { Metadata, register, type ObjectTarget } from '../../server/metadata/index.js';
import { numberAndDate, rubles } from '../money.js';

/**
 * Последняя проведённая продажа без пометки удаления, оплаченная сертификатом: отказ называет её,
 * чтобы продавец знал, куда ушла сумма. Описания берутся из метаданных: импорт продажи замкнул бы
 * её с регистром в кольцо.
 */
const spendingSale = (certificate: string) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const metadata = yield* Metadata;
    const sale = metadata.find('document', 'sale');
    if (sale === undefined) return undefined;
    const lines = yield* database.all(query(sale).tablePart('certificates').select({
        columns: ['ownerGuid'],
        where: [{ column: 'certificate', operator: '=', value: certificate }],
    }));
    if (lines.length === 0) return undefined;
    const found = yield* database.get(query(sale).select({
        columns: ['number', 'date'],
        where: [
            { column: 'guid', operator: 'IN', value: [...new Set(lines.map((line) => String(line['ownerGuid'])))] },
            { column: 'posted', operator: '=', value: true },
            { column: 'deletedAt', operator: '=', value: null },
        ],
        orderBy: [{ column: 'date', direction: 'DESC' }, { column: 'number', direction: 'DESC' }],
        limit: 1,
    }));
    return found === undefined ? undefined : { number: String(found['number']), date: String(found['date']) };
});

/**
 * Ограничение `balance` не даёт остатку уйти в минус: продажа не спишет больше остатка, а отмена
 * проведения сертификата или возврата, сумму которых уже потратили, отклоняется.
 */
export const CertificateBalances = register('certificateBalances')
    .title('Остатки сертификатов')
    // Сертификат проводит движения в этот регистр, а его поле остатка читает итог регистра.
    // Ссылка задана функцией с явным типом, чтобы файлы не зависели друг от друга при загрузке.
    .dimension('certificate', (field) => field.reference((): ObjectTarget => ({ kind: 'document', name: 'certificate' })).title('Сертификат').required())
    .resource('amount', (field) => field.money().title('Сумма').required())
    .constraint('balance', (constraint) => constraint
        .by(['certificate'])
        .minimum('amount', 0)
        .message(({ dimensions, totals }) => Effect.gen(function* () {
            const database = yield* ReadonlyDatabase;
            const metadata = yield* Metadata;
            const description = metadata.find('document', 'certificate');
            const certificate = description === undefined ? undefined : yield* database.get(query(description).select({
                columns: ['number', 'date'],
                where: [{ column: 'guid', operator: '=', value: dimensions.certificate }],
                limit: 1,
            }));
            const title = certificate === undefined ? 'сертификата' : `сертификата ${numberAndDate({ number: String(certificate['number']), date: String(certificate['date']) })}`;
            const sale = yield* spendingSale(dimensions.certificate);
            const spent = sale === undefined ? '' : `: сумму потратили в продаже ${numberAndDate(sale)}`;
            return `Остаток ${title} уходит в минус на ${rubles(-totals.amount)}${spent}`;
        })));
