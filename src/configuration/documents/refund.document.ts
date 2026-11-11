/**
 * Возврат: товары, которые покупатель вернул по продажам, и расчёт с ним. Строка товара ссылается
 * на продажу. Товары показывают, что вернули: проведённый возврат записывает в регистр «Продажи
 * за вычетом возвратов» итог своих товаров с минусом по каждой продаже и этим уменьшает сумму,
 * которую по ней ещё можно вернуть; саму продажу возврат не изменяет.
 *
 * Расчёты показывают, как магазин рассчитался с покупателем, отдельно по каждой продаже:
 * пополнил сертификат, которым была оплачена продажа, погасил возвратом долг по собственной
 * рассрочке или выдал деньги. Правила и движения каждого способа собраны в плане расчётов
 * (`refund-plan.ts`). Деньги относятся к смене продажи, а не к смене возврата: результат смены
 * считается с учётом возвратов по её продажам. Смена в шапке показывает, когда возврат оформлен.
 *
 * Предел возврата проверяет ограничение итога регистра, а не политика: оно действует при
 * проведении и при записи проведённого возврата, а непроведённый возврат записывается без
 * проверки, как черновик. Предел погашения так же проверяет ограничение регистра «Долги по рассрочкам».
 */
import { readRefundFigures, refundFiguresFunction } from './refund.functions.js';
import { Effect } from 'effect';
import { ActionDispatcher, callFunction } from '../../server/data/action-context.js';
import { DataPolicyError, DataValidationError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { formatDateTime, formatMoney, normalizeSearchText } from '../../server/ui/value-format.js';
import { document, movements, type Policy, type RecordOf, type RegisterMovements } from '../../server/metadata/index.js';
import { InstallmentRates } from '../catalogs/installment-rates.catalog.js';
import { Goods } from '../goods.js';
import { installmentDebt, ownInstallment } from '../installments.js';
import { numberAndDate, rubles } from '../money.js';
import { type PayoutPart } from '../money-shares.js';
import { certificateRefill, debtSettlement, installmentMethod, paymentMethods, paymentsWithoutReceiver, receiverField } from '../payments.js';
import { operationMovements, operationOf, planRefund, plannedTotal, refundOperationHandlers, type CertificateTerms, type ExecutionContext, type SaleSettlementTerms } from '../refund-plan.js';
import { SalesNetOfReturns } from '../registers/sales-net-of-returns.register.js';
import { Certificate, readCertificateFeed } from './certificate.document.js';
import { Sale } from './sale.document.js';
import { readInitialPayments, readInstallmentPaymentFeed, SaleInstallment } from './sale-installment.document.js';
import { preventPostedDocumentDeletionPolicy } from '../policies/posted-document-deletion.js';
import { closedPeriodByDocumentDatePolicy } from '../policies/closed-period.js';
import { Shift } from './shift.document.js';

/**
 * Способы расчёта возврата: деньги, «В счёт долга» (погашение долга по рассрочке: покупатель
 * получает назад ту часть, которую ещё не внёс, уменьшением долга) и «На сертификат»
 * (пополнение сертификата, которым была оплачена продажа).
 */
const settlementMethods = [...paymentMethods, debtSettlement, certificateRefill];

const rejected = (message: string) => new DataPolicyError({ message });

/** Рассрочка по продаже: основание движений погашения и цель вложенной записи, которая снимает закрытие. */
const installmentTarget = { kind: 'document', name: 'saleInstallment' } as const;

/** Способ расчёта строки ленты, когда в продаже или возврате их несколько: так же пишет продажа. */
const complexMethod = 'Сложная';

/**
 * Вид строки словами: поиск ленты находит возвраты по слову «возврат», продажи — по слову «продажа»,
 * оформление и обмен сертификатов — по слову «сертификат», обмен ещё и по слову «обмен»,
 * взносы — по словам «взнос» и «рассрочка».
 */
const kindTitles = { sale: 'Продажа', refund: 'Возврат', certificate: 'Сертификат', certificateExchange: 'Сертификат обмен', payment: 'Взнос рассрочка' } as const;

/** Товар строки ленты: код необязателен, ведущие нули сохраняются как текст. */
interface FeedGoods {
    readonly code: string | null;
    readonly name: string;
}

/** Продажа-основание возврата в строке ленты: номер и дата, по которым продавец её узнаёт. */
interface FeedSale {
    readonly guid: string;
    readonly number: string;
    readonly date: string;
}

/**
 * Строка ленты продаж и возвратов. `kind` выбирает компонент строки на клиенте. `method` —
 * способ оплаты продажи, способ выдачи возврата или способ оплаты и обмена сертификата, `amount` —
 * сумма продажи, итог возвращённых товаров или номинал сертификата в копейках. `sales` —
 * продажи-основания возврата; у остальных строк список пуст. `holder` — ФИО держателя сертификата,
 * у продаж и возвратов `null`. Строки сертификата и взноса не содержат товаров. У взноса `guid`
 * и `number` принадлежат рассрочке, `sales` содержит её продажу, а `line` номер строки взноса.
 */
interface FeedRow {
    readonly kind: 'sale' | 'refund' | 'certificate' | 'certificateExchange' | 'payment';
    readonly line?: number;
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly method: string;
    readonly goods: ReadonlyArray<FeedGoods>;
    readonly amount: number;
    readonly sales: ReadonlyArray<FeedSale>;
    /** В продаже применён хотя бы один купон: строка ленты показывает его значок. У возврата `false`. */
    readonly coupon: boolean;
    /** Продажа оплачена хотя бы одним сертификатом: строка ленты показывает его значок. У возврата `false`. */
    readonly certificate: boolean;
    readonly holder: string | null;
}

/**
 * Лента продаж и возвратов для рабочего места продавца: проведённые документы без пометки удаления,
 * новые сверху, страницами. Сертификаты стоят в ленте своими строками в момент оформления и в момент
 * обмена на деньги (`readCertificateFeed`): деньги за них проходят через продавца, хотя кассу смены
 * не меняют. Последующие взносы по рассрочкам стоят своими строками в день внесения
 * (`readInstallmentPaymentFeed`). Сумма продажи считается по правилу сводки за период: из неё
 * вычитается оплата «Рассрочка» и прибавляются первоначальные взносы (`readInitialPayments`), а доля
 * сертификатов остаётся в сумме. Все виды стоят в одной последовательности по дате, поэтому
 * страницы нарезаются здесь: две ленты по отдельности, склеенные на клиенте, давали бы на второй
 * странице разные дни.
 *
 * Функция объявлена у возврата: из двух документов только он может импортировать другой,
 * а импорт возврата в продажу замкнул бы файлы в круг.
 *
 * Без поиска читаются только первые `offset + pageSize` документов каждого вида: этого достаточно,
 * чтобы собрать страницу общей ленты. Поиск устроен как подбор продажи: строка делится на слова,
 * и документ подходит, если каждое слово есть в его виде («продажа», «возврат»), дате и времени,
 * способе, кодах и названиях товаров, сумме, номере или номере продажи-основания возврата. Слова ищутся в тексте на сервере, а не запросом LIKE: LIKE в Turso
 * различает регистр кириллицы. Поэтому при поиске читаются все проведённые документы.
 */
const sellerFeed = (search: string, page: number, pageSize: number) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const offset = (page - 1) * pageSize;
    const words = normalizeSearchText('string', search).split(/\s+/u).filter((word) => word !== '');
    const where = [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }] as const;
    const orderBy = [{ column: 'date', direction: 'DESC' }, { column: 'number', direction: 'DESC' }] as const;
    const limit = words.length === 0 ? { limit: offset + pageSize } : {};
    const sales = yield* database.all(query(Sale).select({ columns: ['guid', 'number', 'date', 'paymentMode', 'paidByCertificates'], where, orderBy, ...limit }));
    const refunds = yield* database.all(query(refund).select({ columns: ['guid', 'number', 'date'], where, orderBy, ...limit }));
    const certificates = yield* readCertificateFeed(words.length === 0 ? offset + pageSize : null);
    const payments = yield* readInstallmentPaymentFeed(words.length === 0 ? offset + pageSize : null);

    // Табличные части читаются только у прочитанных документов, по порядку строк.
    // Исходные суммы и товары продаж берёт общая функция; возвраты остаются отдельными строками ленты.
    const saleFigures = new Map((yield* callFunction(Sale, 'figures', { date: null, sales: sales.map((row) => ({ guid: row.guid })) })).map((row) => [row.sale, row]));
    const refundFigures = yield* readRefundFigures(refunds.map((row) => row.guid), null);
    const goodsOf = new Map([...saleFigures.values()].map((sale) => [sale.sale, sale.goods]));
    const initialOf = yield* readInitialPayments(sales.map((row) => row.guid));
    // Деньги продажи: долг рассрочки не входит, первоначальный взнос входит, как в сводке за период.
    const saleAmount = (guid: string) => {
        const figures = saleFigures.get(guid)!;
        return figures.amount - figures.payments.installment + (initialOf.get(guid) ?? 0);
    };
    const rows: FeedRow[] = [
        // У продажи, целиком оплаченной сертификатами, способа нет: строка показывает только значок сертификата.
        ...sales.map((row): FeedRow => ({
            kind: 'sale', guid: row.guid, number: row.number, date: row.date, method: row.paymentMode ?? '', goods: goodsOf.get(row.guid) ?? [], amount: saleAmount(row.guid), sales: [],
            coupon: (goodsOf.get(row.guid) ?? []).some((line) => (line.couponPercent ?? 0) > 0 || (line.couponDenomination ?? 0) > 0), certificate: (row.paidByCertificates ?? 0) > 0, holder: null,
        })),
        ...refundFigures.map((row): FeedRow => {
            const methods = row.methods;
            return { kind: 'refund', guid: row.refund, number: row.number, date: row.date, method: methods.length === 1 ? methods[0]! : methods.length === 0 ? '' : complexMethod, goods: row.goods, amount: row.amount, sales: row.sales, coupon: false, certificate: false, holder: null };
        }),
        ...certificates.rows.map((row): FeedRow => ({ ...row, goods: [], sales: [], coupon: false, certificate: false })),
        ...payments.rows.map((row): FeedRow => ({ ...row, goods: [], coupon: false, certificate: false })),
    ];
    // Даты хранятся строками ISO одного вида, поэтому сравниваются как текст.
    rows.sort((left, right) => right.date.localeCompare(left.date) || right.number.localeCompare(left.number));

    if (words.length === 0) {
        const saleCount = yield* database.get(query(Sale).count({ where }));
        const refundCount = yield* database.get(query(refund).count({ where }));
        return { total: (saleCount?.total ?? 0) + (refundCount?.total ?? 0) + certificates.total + payments.total, rows: rows.slice(offset, offset + pageSize) };
    }
    const matched = rows.filter((row) => {
        // Сумма добавлена и без пробелов разрядов: «13256» и «13 256» находят один документ.
        const money = formatMoney(row.amount);
        const goods = row.goods.flatMap((line) => line.code === null ? [line.name] : [line.code, line.name]);
        // Возврат находится и по номеру своей продажи-основания, сертификат — по ФИО держателя.
        const sales = row.sales.map((sale) => String(Number(sale.number)));
        // Продажа с сертификатом находится и по слову «сертификат».
        const text = normalizeSearchText('string', [kindTitles[row.kind], formatDateTime(row.date), row.method, row.certificate ? 'сертификат' : '', ...goods, money, money.replace(/\s/gu, ''), String(Number(row.number)), ...sales, row.holder ?? ''].join(' '));
        return words.every((word) => text.includes(word));
    });
    return { total: matched.length, rows: matched.slice(offset, offset + pageSize) };
});

/**
 * Описание без политик, проведения и действий: они читают запись возврата, а ссылка на `Refund`
 * из его же объявления не дала бы вывести тип.
 *
 * Строка расчёта ссылается на продажу из оснований: расчёты ведутся по каждой продаже отдельно,
 * даже если в возврате товары нескольких продаж. «Откуда выдано» — то же составное поле, что
 * «Куда оплачено» у оплаты: приёмник из справочника или текст.
 */
const refund = document('refund')
    .title('Возврат')
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    .tablePart('bases', (part) => part
        .title('На основании')
        .field('sale', (field) => field.reference(Sale).title('Продажа').required()))
    .tablePart('goods', (part) => part
        .title('Товары на возврат')
        .include(Goods)
        .field('sale', (field) => field.reference(Sale).title('Продажа').required()))
    .tablePart('settlements', (part) => part
        .title('Расчёты возврата')
        .field('sale', (field) => field.reference(Sale).title('Продажа').required())
        .field('method', (field) => field.string().title('Способ').choices(settlementMethods).required())
        .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
        .field('receiver', (field) => receiverField(field).title('Откуда выдано'))
        // Сертификат продажи, который пополняет строка «На сертификат»; у остальных строк пусто.
        .field('certificate', (field) => field.reference(Certificate).title('Сертификат')))
    .listTableParts(['goods']);

type RefundRecord = RecordOf<typeof refund>;
type Settlement = RefundRecord['settlements'][number];

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
    if (refund.goods.length === 0) return yield* rejected('В возврате нет товаров: провести можно только возврат с товарами');
    if (refund.bases.length === 0) return yield* rejected('Возврат не связан ни с одной продажей');
    const bases = new Set(refund.bases.map((line) => line.sale));
    for (const [index, line] of refund.goods.entries()) {
        if (!bases.has(line.sale)) return yield* rejected(`Строка ${index + 1}: товар не из продажи, связанной с возвратом`);
    }
});

/**
 * Правила состава возврата. Проверка одинакова при записи и при проведении, не зависит от статуса
 * проведения: записать возврат с нарушенным составом нельзя даже в черновике.
 */
const refundGoodsPolicy: Policy<RefundContent> = {
    name: 'refund-goods',
    save: ({ proposedRecord }) => checkRefundContent(proposedRecord),
    post: ({ document }) => checkRefundContent(document),
};

/**
 * Читает условия расчёта по продаже. `excludedRefund` — возврат, открытый на форме или проверяемый
 * правилом: его прежнее погашение возвращается в остаток, иначе изменение возврата посчитало бы
 * его погашение дважды.
 *
 * Части оплаты: деньги — сумма продажи без оплат «Рассрочка», каждая рассрочка без пометки
 * удаления своей суммой с долей банка у банковской, неоформленная часть оплаты «Рассрочка» без
 * доли банка. Возврат делится по ним так же, как его делит расчёт зарплаты. Оплата сертификатами
 * в части не входит: её возврат пополняет сертификат (`certificates`). По каждому сертификату
 * доступно списание продажи за вычетом пополнений других проведённых возвратов без пометки удаления.
 */
const saleTerms = (saleGuid: string, excludedRefund: string | null) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const sale = yield* database.get(query(Sale).select({ columns: ['guid', 'number', 'date', 'shift', 'amount'], where: [{ column: 'guid', operator: '=', value: saleGuid }], limit: 1 }));
    if (sale === undefined) return yield* rejected('Продажа из возврата не найдена');
    const payments = yield* database.all(query(Sale).tablePart('payments').select({ columns: ['method', 'amount'], where: [{ column: 'ownerGuid', operator: '=', value: saleGuid }] }));
    const byInstallment = payments.filter((payment) => payment.method === installmentMethod).reduce((total, payment) => total + payment.amount, 0);
    const installments = yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'number', 'date', 'type', 'rate', 'amount', 'balance', 'posted', 'closedAt'],
        where: [{ column: 'sale', operator: '=', value: saleGuid }, { column: 'deletedAt', operator: '=', value: null }],
        orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'number', direction: 'ASC' }],
    }));
    const lines = yield* database.all(query(Sale).tablePart('certificates').select({
        columns: ['certificate', 'amount'], where: [{ column: 'ownerGuid', operator: '=', value: saleGuid }], orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
    }));
    const refills = lines.length === 0 ? [] : yield* priorRefills(saleGuid, excludedRefund);
    const certificates = lines.map((line): CertificateTerms => {
        const refilled = refills.filter((refill) => refill.certificate === line.certificate).reduce((total, refill) => total + refill.amount, 0);
        return { certificate: line.certificate, amount: line.amount, available: Math.max(0, line.amount - refilled) };
    });
    const paidByCertificates = lines.reduce((total, line) => total + line.amount, 0);
    const parts: PayoutPart[] = [{ amount: sale.amount - byInstallment - paidByCertificates, bankPercentage: 0 }];
    for (const installment of installments) {
        const rate = installment.type === ownInstallment || installment.rate === null ? undefined
            : yield* database.get(query(InstallmentRates).select({ columns: ['percentage'], where: [{ column: 'guid', operator: '=', value: installment.rate }], limit: 1 }));
        parts.push({ amount: installment.amount, bankPercentage: rate?.percentage ?? 0 });
    }
    const arranged = installments.filter((installment) => installment.posted).reduce((total, installment) => total + installment.amount, 0);
    const unarranged = Math.max(0, byInstallment - arranged);
    const all = installments.reduce((total, installment) => total + installment.amount, 0);
    // Неоформленная часть входит в деление без доли банка, как в расчёте зарплаты.
    if (byInstallment > all) parts.push({ amount: byInstallment - all, bankPercentage: 0 });
    const first = installments[0];
    let installment: SaleSettlementTerms['installment'] = null;
    if (first !== undefined) {
        // Остаток без движений исключённого возврата: столько он может погасить. Разница с текущим
        // остатком — погашение, которое этот возврат уже записал.
        const balance = excludedRefund === null ? first.balance : yield* installmentDebt(first.guid, { document: 'refund', guid: excludedRefund });
        installment = {
            guid: first.guid, number: first.number, date: first.date, type: first.type, posted: first.posted, closed: first.closedAt !== null,
            balance, settled: balance - first.balance,
        };
    }
    const terms: SaleSettlementTerms = { sale, parts, certificates, unarranged, installment };
    return terms;
});

/**
 * Пополнения сертификатов по продаже в проведённых возвратах без пометки удаления, кроме
 * `excludedRefund`: строки «На сертификат» с продажей `saleGuid`.
 */
const priorRefills = (saleGuid: string, excludedRefund: string | null) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const lines = yield* database.all(query(refund).tablePart('settlements').select({
        columns: ['ownerGuid', 'certificate', 'amount'],
        where: [{ column: 'sale', operator: '=', value: saleGuid }, { column: 'method', operator: '=', value: certificateRefill }],
    }));
    const owners = lines.map((line) => line.ownerGuid).filter((guid) => guid !== excludedRefund);
    if (owners.length === 0) return [];
    const active = new Set((yield* database.all(query(refund).select({
        columns: ['guid'],
        where: [{ column: 'guid', operator: 'IN', value: [...new Set(owners)] }, { column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }],
    }))).map((row) => row.guid));
    return lines.filter((line) => active.has(line.ownerGuid)).map((line) => ({ certificate: line.certificate ?? '', amount: line.amount }));
});

/** Сумма строк. */
const sumOf = (lines: ReadonlyArray<{ readonly amount: number }>) => lines.reduce((total, line) => total + line.amount, 0);

/** Строка расчёта для сравнения с прежней записью: колонки по порядку, пустые как `null`. */
const settlementKey = (line: Settlement) => JSON.stringify([line.sale, line.method, line.amount, line.receiver ?? null, line.certificate ?? null]);

/**
 * Проверяет расчёты возврата (раздел «Правила учёта»). `posting` — возврат проводится или уже
 * проведён: тогда действуют и правила, без которых возврат не может попасть в учёт.
 *
 * - Строка относится к продаже из оснований, и у продажи не больше одной строки каждого способа,
 *   а у «На сертификат» — каждого сертификата.
 * - У новых и изменённых строк деньгами «Откуда выдано» обязательно, у строк «В счёт долга»
 *   и «На сертификат» оно пусто. Сертификат указывается только у строки «На сертификат».
 * - Строки «На сертификат» совпадают с пополнениями плана расчётов (`planRefund`): пополнение
 *   обязательно, и его сумму выбирает не продавец.
 * - «В счёт долга» допустимо только у продажи с проведённой собственной рассрочкой, которая ещё не закрыта:
 *   банковскую рассрочку банк уже оплатил, и возврат по ней выдаётся деньгами, а закрытая погашена.
 *   Изменить уже записанное погашение закрытой рассрочки можно только в меньшую сторону: так возврат
 *   снова открывает рассрочку, а увеличить погашенный долг нечем.
 * - Расчёты по продаже не больше суммы операций плана: итога её товаров без доли банка. Меньше
 *   допустимо: магазин может удержать часть суммы, форма об этом предупреждает.
 * - Проводится только возврат, у продаж которого оплата «Рассрочка» покрыта проведёнными
 *   рассрочками: иначе неизвестно, есть ли долг, который можно погасить возвратом.
 *
 * Предел погашения остатком проверяет и ограничение регистра «Долги по рассрочкам», когда проведение
 * записывает движение погашения.
 */
const checkSettlements = (record: RefundRecord, existing: RefundRecord | null, posting: boolean) => Effect.gen(function* () {
    const bases = new Set(record.bases.map((line) => line.sale));
    const seen = new Set<string>();
    for (const [index, line] of record.settlements.entries()) {
        const place = `Строка расчёта ${index + 1}`;
        if (!bases.has(line.sale)) return yield* rejected(`${place}: продажа не из оснований возврата`);
        // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
        const certificate = line.certificate ?? null;
        const refill = line.method === certificateRefill;
        if (refill && certificate === null) return yield* rejected(`${place}: укажите сертификат, который пополняет возврат`);
        if (!refill && certificate !== null) return yield* rejected(`${place}: сертификат указывается только у строки «${certificateRefill}»`);
        const key = JSON.stringify([line.sale, line.method, certificate]);
        if (seen.has(key)) {
            return yield* rejected(refill ? `${place}: этот сертификат по этой продаже уже пополняется другой строкой`
                : `${place}: способ «${line.method}» по этой продаже уже указан. У продажи не больше одной строки расчёта каждого способа`);
        }
        seen.add(key);
        if ((line.method === debtSettlement || refill) && (line.receiver ?? null) !== null) return yield* rejected(`${place}: у строки «${line.method}» «Откуда выдано» не заполняется: деньги не выдаются`);
    }
    const withoutReceiver = paymentsWithoutReceiver(existing?.settlements ?? [], record.settlements, settlementKey);
    if (withoutReceiver.length > 0) {
        return yield* new DataValidationError({
            message: `Строки расчёта ${withoutReceiver.map((index) => index + 1).join(', ')}: укажите «Откуда выдано»`,
            fields: withoutReceiver.map((index) => `payload.fields.settlements.${index}.receiver`),
        });
    }
    const sales = [...new Set([...record.goods.map((line) => line.sale), ...record.settlements.map((line) => line.sale)])];
    for (const saleGuid of sales) {
        const terms = yield* saleTerms(saleGuid, record.guid);
        const title = `Продажа ${numberAndDate(terms.sale)}`;
        const lines = record.settlements.filter((line) => line.sale === saleGuid);
        const credit = lines.find((line) => line.method === debtSettlement);
        if (credit !== undefined) {
            const installment = terms.installment;
            if (installment === null || !installment.posted) return yield* rejected(`${title}: нет проведённой рассрочки, погасить возвратом долг нельзя`);
            if (installment.type !== ownInstallment) return yield* rejected(`${title}: банковскую рассрочку банк уже оплатил, возврат по ней выдаётся деньгами`);
            if (installment.closed && credit.amount > installment.settled) return yield* rejected(`${title}: рассрочка ${numberAndDate(installment)} закрыта, долг погашен. Возврат выдаётся деньгами`);
            // То же проверит ограничение регистра при записи погашения, но его отказ не назвал бы ни рассрочку, ни выход.
            if (credit.amount > installment.balance) {
                return yield* rejected(`${title}: в счёт долга ${rubles(credit.amount)}, а остаток рассрочки ${numberAndDate(installment)} ${rubles(installment.balance)}. Разницу ${rubles(credit.amount - installment.balance)} выдайте наличными или безналичными`);
            }
        }
        const total = sumOf(record.goods.filter((line) => line.sale === saleGuid).map((line) => ({ amount: line.total })));
        const plan = yield* planRefund(terms, total);
        // Пополнения сверяются по каждому сертификату: строка есть у каждого пополнения плана с той же суммой, лишних строк нет.
        const refills = plan.flatMap((operation) => operation.kind === 'certificateRefill' ? [operation] : []);
        const refillLines = lines.filter((line) => line.method === certificateRefill);
        for (const refill of refills) {
            const line = refillLines.find((candidate) => candidate.certificate === refill.certificate);
            if (line === undefined) return yield* rejected(`${title}: возврат пополняет сертификат на ${rubles(refill.amount)}, а строки «${certificateRefill}» нет`);
            if (line.amount !== refill.amount) return yield* rejected(`${title}: пополнение сертификата ${rubles(refill.amount)}, а в строке «${certificateRefill}» ${rubles(line.amount)}`);
        }
        if (refillLines.some((line) => !refills.some((refill) => refill.certificate === line.certificate))) {
            return yield* rejected(`${title}: сертификат в строке «${certificateRefill}» не пополняется этим возвратом: он не оплачивал продажу или уже пополнен прежними возвратами`);
        }
        const expected = plannedTotal(plan);
        const settled = sumOf(lines);
        if (settled > expected) return yield* rejected(`${title}: расчёты ${rubles(settled)} больше ожидаемой выдачи ${rubles(expected)} на ${rubles(settled - expected)}`);
        if (posting && terms.unarranged > 0) {
            return yield* rejected(`${title}: оплата «${installmentMethod}» ${rubles(terms.unarranged)} не оформлена проведённой рассрочкой. Оформите или проведите рассрочку, затем проведите возврат`);
        }
    }
});

/**
 * Правила расчётов действуют при любой записи, как и правила состава: ошибку в расчёте продавец
 * видит сразу. Правила проведения проверяются при проведении и при записи проведённого возврата:
 * она проводит его заново без политики проведения.
 */
const refundSettlementsPolicy: Policy<RefundRecord> = {
    name: 'refund-settlements',
    save: ({ existingRecord, proposedRecord }) => checkSettlements(proposedRecord, existingRecord, proposedRecord.posted),
    // При проведении строки не меняются: «Откуда выдано» проверила запись перед ним. Новое погашение
    // только уменьшает долг, поэтому открывать рассрочки при проведении не нужно.
    post: ({ document }) => checkSettlements(document, document, true),
    // Отмена проведения снимает погашения: долг закрытой рассрочки может снова вырасти.
    unpost: ({ document }) => reopenInstallments(document.guid, [...creditsOf(document).keys()], new Map()),
};

/**
 * Запись проведённого возврата проводит его заново без политики проведения. Если она уменьшает
 * погашение или убирает строку «В счёт долга», долг закрытой рассрочки снова растёт: закрытие
 * снимается до перезаписи движений. Правила расчётов проверяет `refund-settlements`.
 */
const refundReopeningPolicy: Policy<RefundRecord> = {
    name: 'refund-reopening',
    save: ({ existingRecord, proposedRecord }) => {
        if (existingRecord === null || !existingRecord.posted) return Effect.void;
        const credits = creditsOf(proposedRecord);
        return reopenInstallments(proposedRecord.guid, [...new Set([...creditsOf(existingRecord).keys(), ...credits.keys()])], credits);
    },
};

/**
 * Погашение долга по продажам: сумма строк, операции которых снимают закрытие рассрочки
 * (`reopensInstallment` обработчика), по каждой продаже. Сейчас это строки «В счёт долга».
 */
const creditsOf = (record: RefundRecord | null) => {
    const credits = new Map<string, number>();
    for (const line of record?.settlements ?? []) {
        if (!refundOperationHandlers[operationOf(line).kind].reopensInstallment) continue;
        credits.set(line.sale, (credits.get(line.sale) ?? 0) + line.amount);
    }
    return credits;
};

/**
 * Снимает закрытие с рассрочек, долг которых после изменения или отмены проведения возврата снова
 * больше нуля (раздел «Правила учёта»): прежнее погашение уже не подтверждает, что долг погашен.
 * Рассрочку закрывают заново, как после «Внести изменения».
 *
 * Вызывается политикой до того, как возврат перепишет движения: новый долг — итог регистра без
 * движений этого возврата за вычетом нового погашения `credits`. Проверяются рассрочки продаж
 * и из прежних, и из новых строк «В счёт долга»: строку могли убрать. Снятие закрытия записывает
 * рассрочку вложенным `save`, и её политика проверяет закрытый период и право на «Внести изменения».
 */
const reopenInstallments = (refundGuid: string, sales: ReadonlyArray<string>, credits: ReadonlyMap<string, number>) => Effect.gen(function* () {
    if (sales.length === 0) return;
    const database = yield* ReadonlyDatabase;
    const dispatcher = yield* ActionDispatcher;
    const installments = yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'sale', 'closedAt'],
        where: [{ column: 'sale', operator: 'IN', value: [...sales] }, { column: 'deletedAt', operator: '=', value: null }, { column: 'posted', operator: '=', value: true }],
    }));
    for (const installment of installments) {
        if (installment.closedAt === null) continue;
        const debt = (yield* installmentDebt(installment.guid, { document: 'refund', guid: refundGuid })) - (credits.get(installment.sale) ?? 0);
        if (debt <= 0) continue;
        const current = (yield* dispatcher.execute({ target: installmentTarget, action: 'get', payload: { guid: installment.guid } })) as RecordOf<typeof SaleInstallment>;
        yield* dispatcher.execute({ target: installmentTarget, action: 'save', payload: { guid: installment.guid, fields: { ...current, closedAt: null } } });
    }
});

/**
 * Товары в возврат добавляют флажки у товаров продаж под строками части «На основании»
 * (форма возврата): отметка копирует товар в «Товары на возврат» со ссылкой на продажу, а форма
 * заполняет расчёты по этой продаже.
 */
const refundWithPolicies = refund
    .policy(refundGoodsPolicy)
    .policy(refundSettlementsPolicy)
    .policy(refundReopeningPolicy)
    // Пометка удаления не зависит от состава строк: правило состава её не вызывает. Проведённый возврат помечают на удаление только после отмены проведения.
    .policy(preventPostedDocumentDeletionPolicy())
    // Возврат относится к периоду своей датой, а не датой продажи: возврат по продаже закрытого
    // периода допустим и уменьшает зарплату в новом периоде.
    .policy(closedPeriodByDocumentDatePolicy())
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе табличные части оказались бы над ней.
    .form((form) => form
        .group('Возврат', ['number', 'date', 'shift'])
        .group('На основании', ['bases'])
        .group('Товары на возврат', ['goods'])
        .group('Расчёты возврата', ['settlements'])
        .hide('posted'))
    // Движения товаров записываются на продажу, а не на строку: предел действует на сумму по продаже.
    // Смена движений — смена продажи: возврат уменьшает результат тех, кто продал. Строки расчётов
    // превращаются в операции плана, и движения по ним отдают обработчики видов операций.
    // План при этом не пересчитывается: расхождение строк с ним отклоняет политика расчётов.
    .posting((record) => Effect.gen(function* () {
        const returned = new Map<string, number>();
        for (const line of record.goods) returned.set(line.sale, (returned.get(line.sale) ?? 0) + line.total);
        const database = yield* ReadonlyDatabase;
        const shifts = new Map<string, string>();
        for (const saleGuid of new Set([...returned.keys(), ...record.settlements.map((line) => line.sale)])) {
            const sale = yield* database.get(query(Sale).select({
                columns: ['shift'],
                where: [{ column: 'guid', operator: '=', value: saleGuid }],
                limit: 1,
            }));
            if (sale === undefined) return yield* rejected('Продажа из строки возврата не найдена');
            shifts.set(saleGuid, sale.shift);
        }
        // Рассрочка читается только у продаж с погашением долга: её движения нужны только ему.
        const contexts = new Map<string, ExecutionContext>();
        for (const saleGuid of shifts.keys()) {
            let installment: ExecutionContext['installment'] = null;
            if (creditsOf(record).has(saleGuid)) {
                const found = yield* database.get(query(SaleInstallment).select({
                    columns: ['guid', 'person', 'shift'],
                    where: [{ column: 'sale', operator: '=', value: saleGuid }, { column: 'deletedAt', operator: '=', value: null }, { column: 'posted', operator: '=', value: true }],
                    limit: 1,
                }));
                if (found === undefined || found.person === null) return yield* rejected('Рассрочка для погашения долга не найдена или не проведена');
                installment = { guid: found.guid, person: found.person, shift: found.shift };
            }
            contexts.set(saleGuid, { saleShift: shifts.get(saleGuid)!, installment });
        }
        const settlements: RegisterMovements[] = record.settlements.flatMap((line) => [...operationMovements(operationOf(line), contexts.get(line.sale)!)]);
        return [
            // Вычитание из нуля, а не унарный минус: для нулевой суммы он дал бы отрицательный ноль.
            movements(SalesNetOfReturns, [...returned].map(([sale, total]) => ({ sale, shift: shifts.get(sale)!, amount: 0 - total }))),
            ...settlements,
        ];
    }));

/**
 * Товары, которые по продаже уже возвращены: строки товаров проведённых возвратов по этой продаже,
 * кроме возврата `excludedRefund` (открытого на форме). Форма возврата по ним отмечает товары
 * продажи как уже возвращённые и не даёт отметить их снова. Действие только читает.
 *
 * Строки возвращаются в порядке возвратов и строк: товар в возврате не хранит ссылку на строку
 * продажи, поэтому форма сопоставляет строки по содержимому.
 *
 * Действие `settlementTerms` отдаёт форме условия расчёта по продаже и план расчёта за товары
 * на сумму `total`: по нему она заполняет расчёты, ставит неизменяемые строки «На сертификат»
 * и предупреждает о расхождении и погашении долга. План считает сервер тем же расчётом, что
 * и правило расчётов, поэтому форма с ним не расходится. Функция `refundPlan` отдаёт тот же план
 * через API: так его можно проверить, ничего не записывая.
 *
 * Действие `saleRefunds` отдаёт проведённые возвраты по продаже в порядке даты и номера: продажа
 * выводит их под своими рассрочками. Черновики не выводятся: в расчётах они не участвуют. Связь с продажей хранит строка оснований,
 * а отбор списка по строкам табличной части платформа не поддерживает, поэтому нужно действие.
 */
export const Refund = refundWithPolicies
    .function('figures', refundFiguresFunction)
    .action('returnedGoods', (action) => action
        .title('Возвращённые товары')
        .input((input) => input
            .field('sale', (field) => field.reference(Sale).title('Продажа').required())
            .field('excludedRefund', (field) => field.string().title('Исключаемый возврат')))
        .handle((input) => Effect.gen(function* () {
            const database = yield* ReadonlyDatabase;
            const lines = yield* database.all(query(refund).tablePart('goods').select({
                columns: ['ownerGuid', 'name', 'code', 'size', 'comment', 'cost', 'discount', 'couponPercent', 'couponDenomination'],
                where: [{ column: 'sale', operator: '=', value: input.sale }],
                orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
            }));
            if (lines.length === 0) return [];
            const owners = new Set((yield* database.all(query(refund).select({
                columns: ['guid'],
                where: [
                    { column: 'guid', operator: 'IN', value: [...new Set(lines.map((line) => line.ownerGuid))] },
                    { column: 'posted', operator: '=', value: true },
                    { column: 'deletedAt', operator: '=', value: null },
                ],
            }))).map((row) => row.guid));
            owners.delete(input.excludedRefund ?? '');
            return lines.filter((line) => owners.has(line.ownerGuid)).map(({ name, code, size, comment, cost, discount, couponPercent, couponDenomination }) => ({ name, code, size, comment, cost, discount, couponPercent, couponDenomination }));
        })))
    .action('settlementTerms', (action) => action
        .title('Условия расчёта по продаже')
        // Данные читает форма возврата сама: кнопка не нужна.
        .placement('hidden')
        .input((input) => input
            .field('sale', (field) => field.reference(Sale).title('Продажа').required())
            .field('excludedRefund', (field) => field.string().title('Исключаемый возврат'))
            .field('total', (field) => field.money().title('Итог товаров').minimum(0)))
        .handle((input) => Effect.gen(function* () {
            const terms = yield* saleTerms(input.sale, input.excludedRefund ?? null);
            const total = input.total ?? 0;
            return { ...terms, total, plan: yield* planRefund(terms, total) };
        })))
    .action('saleRefunds', (action) => action
        .title('Возвраты по продаже')
        // Данные читает форма продажи сама: кнопка не нужна.
        .placement('hidden')
        .input((input) => input
            .field('sale', (field) => field.reference(Sale).title('Продажа').required()))
        .handle((input) => Effect.gen(function* () {
            const database = yield* ReadonlyDatabase;
            const owners = [...new Set((yield* database.all(query(refund).tablePart('bases').select({
                columns: ['ownerGuid'],
                where: [{ column: 'sale', operator: '=', value: input.sale }],
            }))).map((row) => row.ownerGuid))];
            if (owners.length === 0) return [];
            return yield* database.all(query(refund).select({
                columns: ['guid'],
                where: [{ column: 'guid', operator: 'IN', value: owners }, { column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }],
                orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'number', direction: 'ASC' }],
            }));
        })))
    .function('refundPlan', (builder) => builder
        .title('План расчёта возврата по продаже')
        .input((input) => input
            .field('sale', (field) => field.reference(Sale).title('Продажа').required())
            .field('excludedRefund', (field) => field.string().title('Исключаемый возврат'))
            .field('total', (field) => field.money().title('Итог товаров').minimum(0).required()))
        .handle((input) => Effect.gen(function* () {
            const terms = yield* saleTerms(input.sale, input.excludedRefund ?? null);
            return yield* planRefund(terms, input.total);
        })))
    // Лента рабочего места продавца (`sellerFeed` выше): продажи и возвраты одной последовательностью.
    .function('sellerFeed', (builder) => builder
        .title('Лента продаж и возвратов')
        .input((input) => input
            .field('search', (field) => field.string().title('Поиск'))
            .field('page', (field) => field.number().title('Страница').minimum(1).required())
            .field('pageSize', (field) => field.number().title('Строк на странице').minimum(1).maximum(100).required()))
        .handle((input) => sellerFeed(input.search ?? '', input.page, input.pageSize)));
