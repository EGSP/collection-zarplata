/**
 * Сертификат: счёт покупателя с остатком. С него списывают оплату продаж, пока остаток
 * не обнулится, а возврат по такой продаже пополняет тот же сертификат. Остаток — итог регистра
 * «Остатки сертификатов» по сертификату; проведённый сертификат записывает в регистр свой номинал.
 *
 * Сертификат бывает купленным и выданным без оплаты. У купленного номинал равен оплате, и указаны
 * способ оплаты и «Куда оплачено». Купленный сертификат без расходов можно обменять на деньги
 * действием «Обменять на деньги» на весь номинал. Деньги за сертификаты магазин хранит отдельно
 * от кассы, поэтому ни оплата сертификата, ни обмен не пишут движений в «Поступления денег»
 * (раздел «Правила учёта», подраздел «Сертификат»).
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { normalizeSearchText } from '../../server/ui/value-format.js';
import { document, movements, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { Employees } from '../catalogs/employees.catalog.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { rubles } from '../money.js';
import { paymentMethods, receiverField } from '../payments.js';
import { preventPostedDocumentDeletionPolicy } from '../policies/posted-document-deletion.js';
import { CertificateBalances } from '../registers/certificate-balances.register.js';

/** Вид сертификата, за который покупатель заплатил: только такой обменивается на деньги. */
export const purchasedCertificate = 'Куплен';

/** Вид сертификата, который магазин выдал без оплаты: способа оплаты и «Куда оплачено» у него нет. */
export const freeCertificate = 'Выдан без оплаты';

const target: ObjectTarget = { kind: 'document', name: 'certificate' };

/**
 * Описание без политики, действия и функции: они читают и записывают сам сертификат, а ссылка
 * на `Certificate` из его же объявления не дала бы вывести тип.
 *
 * Дата документа служит датой выдачи. Способ оплаты и «Куда оплачено» у поля необязательны:
 * у сертификата без оплаты их нет, а у купленного их требует политика. Срок действия пока ничего
 * не ограничивает. Обмен на деньги хранится табличной частью по образцу расчётов возврата; её
 * заполняет только действие «Обменять на деньги», оно же ставит время обмена.
 *
 * Остаток не хранится и читается из регистра (`MoneyFieldBuilder.total`): у непроведённого
 * сертификата движений нет, и остаток равен нулю.
 */
const certificate = document('certificate')
    .title('Сертификат')
    .field('person', (field) => field.reference(PhysicalPersons).title('Физическое лицо').required().width('long'))
    .field('denomination', (field) => field.money().title('Номинал').minimum(1).required())
    .field('kind', (field) => field.string().title('Вид').choices([purchasedCertificate, freeCertificate]).initial(purchasedCertificate).required())
    .field('paymentMethod', (field) => field.string().title('Способ оплаты').choices(paymentMethods))
    .field('receiver', receiverField)
    .field('issuedBy', (field) => field.reference(Employees).title('Выдал').required())
    .field('validTo', (field) => field.date().title('Действует по'))
    .field('balance', (field) => field.money().title('Остаток').required().total(() => CertificateBalances, 'amount', 'certificate'))
    .field('exchangedAt', (field) => field.dateTime().title('Обменян на деньги'))
    .tablePart('exchanges', (part) => part
        .title('Обмен на деньги')
        .field('method', (field) => field.string().title('Способ').choices(paymentMethods).required())
        .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
        .field('receiver', (field) => receiverField(field).title('Откуда выдано').required()))
    // Продавец ищет сертификат по покупателю, поэтому представление начинается с держателя: поиск
    // подсказок идёт по представлению. Номер без ведущих нулей различает сертификаты одного
    // человека и оставляет поиск по номеру. Остаток в представление не входит: его показывает
    // окно оплаты под полем выбора.
    .presentation([{ field: 'person' }, { text: ', № ' }, { field: 'number', format: 'number' }])
    // Сертификат движется в регистр номиналом при проведении и обменом на деньги со знаком минус.
    // Период обмена — его время: в истории движений обмен стоит позже выдачи.
    .posting((record) => Effect.succeed([movements(CertificateBalances, [
        { certificate: record.guid, amount: record.denomination },
        ...record.exchanges.map((exchange) => ({ certificate: record.guid, period: record.exchangedAt ?? record.date, amount: 0 - exchange.amount })),
    ])]));

type CertificateRecord = RecordOf<typeof certificate>;

const rejected = (message: string) => new DataPolicyError({ message });

/**
 * Есть ли у сертификата движения других документов: оплаты продаж или пополнения возвратами.
 * Обмен на деньги допустим только без них: тогда он идёт на весь номинал.
 */
const hasForeignMovements = (guid: string) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const row = yield* database.get(query(CertificateBalances).select({
        columns: ['amount'],
        where: [
            { column: 'certificate', operator: '=', value: guid },
            { column: 'recorder', operator: '!=', value: { document: 'certificate', guid } },
        ],
        limit: 1,
    }));
    return row !== undefined;
});

/**
 * Правила сертификата (раздел «Правила учёта», подраздел «Сертификат»):
 * - у купленного указаны способ оплаты и «Куда оплачено», у выданного без оплаты их нет;
 * - обмен на деньги есть только у купленного сертификата, его сумма равна номиналу, и по сертификату
 *   нет движений других документов;
 * - время обмена указано тогда и только тогда, когда есть строки обмена.
 *
 * Остаток ниже нуля не пропускает ограничение регистра: оно отклоняет уменьшение номинала
 * и отмену проведения сертификата, с которого уже списывали.
 */
const certificateRulesPolicy: Policy<CertificateRecord> = {
    name: 'certificate-rules',
    save: ({ proposedRecord }) => Effect.gen(function* () {
        // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
        const method = proposedRecord.paymentMethod ?? null;
        const receiver = proposedRecord.receiver ?? null;
        const exchangedAt = proposedRecord.exchangedAt ?? null;
        if (proposedRecord.kind === purchasedCertificate) {
            if (method === null) return yield* rejected('Укажите способ оплаты купленного сертификата');
            if (receiver === null) return yield* rejected('Укажите, куда оплачен сертификат');
        } else {
            if (method !== null || receiver !== null) return yield* rejected(`У сертификата «${freeCertificate}» нет способа оплаты и «Куда оплачено»`);
            if (proposedRecord.exchanges.length > 0) return yield* rejected(`Сертификат «${freeCertificate}» на деньги не обменивается: магазин не получал за него денег`);
        }
        if (proposedRecord.exchanges.length === 0) {
            if (exchangedAt !== null) return yield* rejected('Время обмена указано без строк обмена на деньги');
            return;
        }
        if (exchangedAt === null) return yield* rejected('Укажите время обмена сертификата на деньги');
        const exchanged = proposedRecord.exchanges.reduce((sum, exchange) => sum + exchange.amount, 0);
        if (exchanged !== proposedRecord.denomination) {
            return yield* rejected(`Обмен на деньги идёт на весь номинал ${rubles(proposedRecord.denomination)}, а в строках обмена ${rubles(exchanged)}`);
        }
        if (yield* hasForeignMovements(proposedRecord.guid)) return yield* rejected('С сертификата уже списывали или его пополняли: на деньги он не обменивается');
    }),
};

/** Действующий сертификат в результате `activeCertificates`: держатель, номинал и остаток. */
interface ActiveCertificate {
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly person: string;
    readonly kind: string;
    readonly denomination: number;
    readonly balance: number;
    readonly validTo: string | null;
}

/**
 * Действующие сертификаты для вкладки «Сертификаты» рабочего места продавца: остаток больше нуля.
 * Остатки читаются одним итогом регистра по сертификатам, а сами сертификаты одним запросом:
 * действие `list` поле остатка не отбирает, потому что оно не хранится.
 *
 * Сертификаты идут по дате выдачи от старых к новым, как отвесы на соседней вкладке. Поиск
 * отбирает их по части ФИО держателя без учёта регистра так же, как поиск отвесов: SQLite
 * сравнивает кириллицу в `LIKE` с учётом регистра, поэтому ФИО сравниваются здесь.
 */
const activeCertificates = (search: string) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const balances = yield* database.all(query(CertificateBalances).sums({ groupBy: ['certificate'], sums: ['amount'] }));
    const balanceOf = new Map(balances.filter((row) => row.amount > 0).map((row) => [row.certificate, row.amount]));
    const found = balanceOf.size === 0 ? [] : yield* database.all(query(certificate).select({
        columns: ['guid', 'number', 'date', 'person', 'kind', 'denomination', 'validTo'],
        where: [{ column: 'guid', operator: 'IN', value: [...balanceOf.keys()] }, { column: 'deletedAt', operator: '=', value: null }],
        orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'number', direction: 'ASC' }],
    }));
    const needle = normalizeSearchText('string', search.trim());
    const persons = needle === '' || found.length === 0 ? [] : yield* database.all(query(PhysicalPersons).select({
        columns: ['guid', 'name'],
        where: [{ column: 'guid', operator: 'IN', value: [...new Set(found.map((row) => row.person))] }],
    }));
    const matched = new Set(persons.filter((row) => normalizeSearchText('string', row.name).includes(needle)).map((row) => row.guid));
    const rows: ReadonlyArray<ActiveCertificate> = (needle === '' ? found : found.filter((row) => matched.has(row.person)))
        .map((row) => ({ ...row, validTo: row.validTo ?? null, balance: balanceOf.get(row.guid) ?? 0 }));
    return { rows };
});

/** Способ в строке ленты у сертификата, выданного без оплаты: денег при выдаче не было. */
const withoutPayment = 'Без оплаты';

/** Способ строки ленты, когда обмен выдан несколькими способами: так же пишет продажа. */
const complexMethod = 'Сложная';

/**
 * Событие сертификата в ленте продавца: оформление (`certificate`) или обмен на деньги
 * (`certificateExchange`). Дата оформления — дата документа, дата обмена — время обмена.
 * `method` — способ оплаты купленного сертификата или способ выдачи денег при обмене,
 * `holder` — ФИО держателя, `amount` — номинал в копейках: обмен всегда идёт на весь номинал.
 */
export interface CertificateFeedRow {
    readonly kind: 'certificate' | 'certificateExchange';
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly method: string;
    readonly holder: string | null;
    readonly amount: number;
}

/**
 * События сертификатов для ленты продавца (функция возврата `sellerFeed`): оформление каждого
 * проведённого сертификата без пометки удаления и обмен тех из них, что обменяны на деньги.
 * Одно событие оформления и одно событие обмена дают две строки ленты с разными датами.
 *
 * `limit` ограничивает число событий каждого вида, новые сверху: так лента без поиска читает только
 * то, что нужно для страницы. При поиске `limit` равен `null` и читаются все события. `total` —
 * число всех событий без ограничения: по нему лента считает страницы.
 */
export const readCertificateFeed = (limit: number | null) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const where = [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }] as const;
    const exchangedWhere = [...where, { column: 'exchangedAt', operator: '!=', value: null }] as const;
    const page = limit === null ? {} : { limit };
    const issued = yield* database.all(query(certificate).select({
        columns: ['guid', 'number', 'date', 'person', 'paymentMethod', 'denomination'],
        where,
        orderBy: [{ column: 'date', direction: 'DESC' }, { column: 'number', direction: 'DESC' }],
        ...page,
    }));
    const exchanged = yield* database.all(query(certificate).select({
        columns: ['guid', 'number', 'exchangedAt', 'person', 'denomination'],
        where: exchangedWhere,
        orderBy: [{ column: 'exchangedAt', direction: 'DESC' }, { column: 'number', direction: 'DESC' }],
        ...page,
    }));
    const exchanges = exchanged.length === 0 ? [] : yield* database.all(query(certificate).tablePart('exchanges').select({
        columns: ['ownerGuid', 'method'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: exchanged.map((row) => row.guid) }],
    }));
    const personGuids = [...new Set([...issued, ...exchanged].map((row) => row.person))];
    const persons = personGuids.length === 0 ? [] : yield* database.all(query(PhysicalPersons).select({
        columns: ['guid', 'name'],
        where: [{ column: 'guid', operator: 'IN', value: personGuids }],
    }));
    const holderOf = new Map(persons.map((row) => [row.guid, row.name]));
    const methodsOf = (guid: string) => [...new Set(exchanges.filter((row) => row.ownerGuid === guid).map((row) => row.method))];
    const rows: CertificateFeedRow[] = [
        ...issued.map((row): CertificateFeedRow => ({
            kind: 'certificate', guid: row.guid, number: row.number, date: row.date,
            method: row.paymentMethod ?? withoutPayment, holder: holderOf.get(row.person) ?? null, amount: row.denomination,
        })),
        ...exchanged.map((row): CertificateFeedRow => {
            const methods = methodsOf(row.guid);
            return {
                kind: 'certificateExchange', guid: row.guid, number: row.number, date: row.exchangedAt ?? '',
                method: methods.length === 1 ? methods[0]! : methods.length === 0 ? '' : complexMethod,
                holder: holderOf.get(row.person) ?? null, amount: row.denomination,
            };
        }),
    ];
    const issuedCount = yield* database.get(query(certificate).count({ where }));
    const exchangedCount = yield* database.get(query(certificate).count({ where: exchangedWhere }));
    return { rows, total: (issuedCount?.total ?? 0) + (exchangedCount?.total ?? 0) };
});

/**
 * Форма сертификата стандартная. Элемент `certificateState` показывает состояние, историю движений
 * и кнопку «Обменять на деньги», очищает способ оплаты и «Куда оплачено» у сертификата без оплаты
 * и запрещает ручное изменение строк обмена.
 */
export const Certificate = certificate
    .form((form) => form
        .group('Сертификат', ['number', 'date', 'person', 'kind', 'denomination', 'paymentMethod', 'receiver', 'issuedBy', 'validTo'])
        .group('Остаток', ['balance', 'exchanges'])
        .title('date', 'Дата выдачи')
        .hide('exchangedAt')
        .hide('posted'))
    .policy(certificateRulesPolicy)
    .policy(preventPostedDocumentDeletionPolicy())
    .action('exchange', (action) => action
        .title('Обменять на деньги')
        // Окно обмена открывает элемент формы `certificateState`: стандартная кнопка не запросила бы поля.
        .placement('hidden')
        .input((input) => input
            .field('certificate', (field) => field.reference(certificate).title('Сертификат').required())
            .field('method', (field) => field.string().title('Способ').choices(paymentMethods).required())
            // Деньги выдаются из кассы или со счёта: откуда, указывается обязательно, как у расчётов возврата.
            .field('receiver', (field) => receiverField(field).title('Откуда выдано').required()))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.certificate } })) as CertificateRecord;
            if (record.kind !== purchasedCertificate) return yield* rejected(`Сертификат «${freeCertificate}» на деньги не обменивается: магазин не получал за него денег`);
            if (!record.posted) return yield* rejected('Сертификат не проведён: сначала проведите его');
            if (record.exchanges.length > 0) return yield* rejected('Сертификат уже обменян на деньги');
            if (yield* hasForeignMovements(record.guid)) return yield* rejected('С сертификата уже списывали или его пополняли: на деньги он не обменивается');
            // Запись проведённого сертификата проводит его заново: движение обмена появляется в регистре
            // в той же транзакции, а политика ещё раз проверяет правила обмена.
            const exchanges = [{ method: input.method, amount: record.denomination, receiver: input.receiver ?? null }];
            return yield* dispatcher.execute({ target, action: 'save', payload: { guid: record.guid, fields: { ...record, exchanges, exchangedAt: new Date().toISOString() } } });
        })))
    // Окно «Оплатить сертификатом» формы продажи. Действие проверяет строку сразу, пока покупатель
    // рядом: сертификат проведён, не помечен на удаление, а сумма не больше остатка без движений
    // этой продажи. Окончательно оплату сертификатами проверяет политика продажи при записи.
    .action('application', (action) => action
        .title('Оплатить сертификатом')
        // Окно открывает форма продажи: кнопка на форме сертификата не нужна.
        .placement('hidden')
        .input((input) => input
            .field('certificate', (field) => field.reference(certificate).title('Сертификат').required().width('free'))
            .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
            .field('sale', (field) => field.reference((): ObjectTarget => ({ kind: 'document', name: 'sale' })).title('Продажа')))
        .handle((input) => Effect.gen(function* () {
            const database = yield* ReadonlyDatabase;
            const record = yield* database.get(query(certificate).select({
                columns: ['number', 'date', 'posted', 'deletedAt'],
                where: [{ column: 'guid', operator: '=', value: input.certificate }],
                limit: 1,
            }));
            if (record === undefined) return yield* rejected('Сертификат не найден');
            if (record.deletedAt !== null) return yield* rejected('Сертификат помечен на удаление');
            if (!record.posted) return yield* rejected('Сертификат не проведён, оплатить им нельзя');
            // Необязательное поле, не переданное в запросе, приходит в действие как `undefined`.
            const sale = input.sale ?? null;
            const rows = yield* database.all(query(CertificateBalances).select({
                columns: ['amount'],
                where: [
                    { column: 'certificate', operator: '=', value: input.certificate },
                    // Прежнее списание записанной продажи возвращается в остаток: её меняют, а не продают заново.
                    ...sale === null ? [] : [{ column: 'recorder', operator: '!=', value: { document: 'sale', guid: sale } } as const],
                ],
            }));
            const balance = rows.reduce((total, row) => total + row.amount, 0);
            if (input.amount > balance) return yield* rejected(`Сумма ${rubles(input.amount)} больше остатка сертификата ${rubles(balance)}`);
            return { certificate: input.certificate, amount: input.amount, balance };
        })))
    // Вкладка «Сертификаты» рабочего места продавца (`activeCertificates` выше).
    .function('activeCertificates', (builder) => builder
        .title('Действующие сертификаты')
        .input((input) => input
            .field('search', (field) => field.string().title('Поиск по ФИО держателя')))
        .handle((input) => activeCertificates(input.search ?? '')));
