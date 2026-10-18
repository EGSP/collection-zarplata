/**
 * Продажа: товары, проданные в смену, и их оплата. Сумма продажи хранится вычисляемым полем шапки:
 * по ней работают списки. Проведённая продажа записывает сумму в регистр «Продажи за вычетом возвратов» со своей сменой;
 * по итогу регистра проверяется предел возврата. Оплаты деньгами она записывает в регистр
 * «Поступления денег» по способам, а сумму оплат способом «Рассрочка» в регистр «Рассрочки
 * по продажам»: на неё оформляются рассрочки по продаже.
 *
 * Продажа может быть оформлена из отвеса: форма отвеса открывает новую продажу с отвесом
 * в основании и выбранными товарами. Строка такого товара хранит номер строки отвеса. Кроме них
 * в продаже могут быть и другие товары. Отвес продажа меняет сама при проведении: её строки
 * переводятся в состояние «Продано» в той же транзакции.
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { Database } from '../../server/database/database.effect.js';
import { document, formula, Metadata, movements, type LookupInput, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { formatDateTime, formatMoney, normalizeSearchText } from '../../server/ui/value-format.js';
import { Employees } from '../catalogs/employees.catalog.js';
import { InstallmentRates } from '../catalogs/installment-rates.catalog.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { Goods } from '../goods.js';
import { installmentTypes, ownInstallment, ownInstallmentRate } from '../installments.js';
import { numberAndDate, rubles } from '../money.js';
import { cash, installmentMethod, paymentColumns, paymentMethods, Payments, receiverField } from '../payments.js';
import { MoneyReceipts } from '../registers/money-receipts.register.js';
import { UnarrangedInstallments } from '../registers/unarranged-installments.register.js';
import { SalesNetOfReturns } from '../registers/sales-net-of-returns.register.js';
import { closedPeriodByDocumentDate } from '../policies/closed-period.js';
import { Shift } from './shift.document.js';
import { Weighing } from './weighing.document.js';

/** Способ оплаты продажи, при котором оплат несколько и у каждой свой способ. */
const complexPayment = 'Сложная';

/**
 * Описание без политики и действия. Они читают запись продажи, а ссылка на `Sale` из его же
 * объявления не дала бы вывести тип.
 *
 * Способ оплаты хранится полем, а не выводится из числа строк оплат: сложная оплата из одной
 * строки неотличима от простой, и форма не знала бы, что показать. Простая оплата тоже хранится
 * строкой части «Оплаты», а не суммой в шапке: движения и правила читают оплаты одинаково при
 * любом способе.
 *
 * Строка оплаты допускает способ «Рассрочка»: деньги по ней не приняты, на её сумму оформляется
 * рассрочка по продаже. Способ оплаты всей продажи «Рассрочка» простой: у продажи одна оплата
 * этим способом на всю сумму.
 */
const sale = document('sale')
    .title('Продажа')
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    // Отвес ссылается на продажу в строках товаров, поэтому файлы импортируют друг друга по кругу.
    // Тип результата указан явно: иначе тип продажи выводился бы через тип отвеса и обратно.
    .field('basis', (field) => field.reference((): ObjectTarget => Weighing).title('Основание'))
    .field('amount', (field) => field.money().title('Сумма').required().computed(formula.sum('goods', 'total')))
    .field('paymentMode', (field) => field.string().title('Способ оплаты').choices([...paymentMethods, installmentMethod, complexPayment]).initial(cash).required())
    .field('paid', (field) => field.money().title('Оплачено').required().computed(formula.sum('payments', 'amount')))
    // Строка отвеса заполнена у товара, взятого из отвеса-основания: по ней проведение отмечает товар проданным.
    .tablePart('goods', (part) => part.title('Товары').include(Goods)
        .field('weighingLine', (field) => field.number().title('Строка отвеса').integer().minimum(1)))
    .tablePart('payments', (part) => part.title('Оплаты').include(paymentColumns([...paymentMethods, installmentMethod])))
    .listTableParts(['goods']);

type SaleRecord = RecordOf<typeof sale>;

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/** Оплата, по которой деньги не приняты: на её сумму оформляется рассрочка по продаже. */
const byInstallment = (payment: SaleRecord['payments'][number]) => payment.method === installmentMethod;

/** Сумма оплат способом «Рассрочка»: на неё оформляются рассрочки по продаже. */
const installmentAmount = (record: SaleRecord) => record.payments.filter(byInstallment).reduce((total, payment) => total + payment.amount, 0);

/**
 * Проверяет оплаты продажи при записи и проведении (раздел «Правила учёта»).
 *
 * Оплаты складываются из строк, а не берутся из поля «Оплачено»: у продажи, записанной до
 * появления оплат, это поле пусто. Простой способ допускает не больше одной оплаты, а не ровно
 * одну: у продажи с нулевой суммой оплат нет, потому что сумма оплаты больше нуля.
 *
 * Способ «Рассрочка» допустим у строки сложной оплаты и у единственной оплаты продажи со способом
 * «Рассрочка». Таких строк у продажи не больше одной. У такой строки «Куда оплачено» пусто: деньги по ней не приняты и придут взносами
 * рассрочки.
 */
const checkPayments = (record: SaleRecord) => {
    const mode = record.paymentMode;
    // Рассрочка по продаже оформляется на одну сумму, поэтому оплата рассрочкой у продажи одна.
    if (record.payments.filter(byInstallment).length > 1) return rejected(`У продажи не больше одной оплаты способом «${installmentMethod}»`);
    for (const [index, payment] of record.payments.entries()) {
        if (!byInstallment(payment)) continue;
        const place = `Строка оплаты ${index + 1}`;
        if (mode !== complexPayment && mode !== installmentMethod) return rejected(`${place}: способ «${installmentMethod}» допустим только при способе оплаты продажи «${installmentMethod}» или «${complexPayment}»`);
        // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
        if ((payment.receiver ?? null) !== null) return rejected(`${place}: у оплаты способом «${installmentMethod}» «Куда оплачено» не заполняется`);
    }
    if (mode !== complexPayment) {
        if (record.payments.length > 1) return rejected(`При способе оплаты «${mode}» у продажи одна оплата, а указано ${record.payments.length}`);
        const method = record.payments[0]?.method ?? mode;
        if (method !== mode) return rejected(`Способ оплаты «${method}» в строке оплаты не совпадает со способом оплаты продажи «${mode}»`);
    }
    const paid = record.payments.reduce((total, payment) => total + payment.amount, 0);
    if (paid < record.amount) return rejected(`Оплаты меньше суммы продажи на ${rubles(record.amount - paid)}`);
    if (paid > record.amount) return rejected(`Оплаты больше суммы продажи на ${rubles(paid - record.amount)}`);
    return Effect.void;
};

/**
 * Правила оплат действуют при любой записи и при проведении: продажа, оплаты которой не сходятся
 * с суммой товаров, не записывается даже непроведённой. Иначе ошибку в оплате продавец увидел бы
 * только при проведении, когда покупатель уже ушёл. Правило простого способа проверяется здесь,
 * а не только элементом формы: иначе запрос через API записал бы продажу «Наличные» с двумя
 * строками оплат.
 */
const salePayments: Policy<SaleRecord> = {
    name: 'sale-payments',
    save: ({ proposedRecord }) => checkPayments(proposedRecord),
    post: ({ document }) => checkPayments(document),
};

/**
 * Проверяет сумму продажи (раздел «Правила учёта»): продажа с нулевой суммой допустима, только если
 * у какого-нибудь товара указана скидка. Иначе ноль означает, что стоимость не заполнили, например
 * у товара, перенесённого из отвеса: отвес стоимость не хранит.
 */
const checkAmount = (record: SaleRecord) => {
    if (record.amount !== 0) return Effect.void;
    if (record.goods.some((line) => (line.discount ?? 0) > 0)) return Effect.void;
    return rejected('Сумма продажи равна нулю: укажите стоимость товаров. Нулевая сумма допустима только со скидкой');
};

/**
 * Правило суммы действует при любой записи, а не только при проведении, по той же причине, что
 * и правила оплат: продавец видит ошибку сразу, пока оформляет продажу.
 */
const saleAmount: Policy<SaleRecord> = {
    name: 'sale-amount',
    save: ({ proposedRecord }) => checkAmount(proposedRecord),
    post: ({ document }) => checkAmount(document),
};

/** Состояние строки отвеса, из которого товар можно продать. Совпадает со значением в описании отвеса. */
const held = 'В отвесе';

/**
 * Отвес вызывается по имени: файл отвеса импортирует продажу, и тип отвеса здесь выводился бы
 * через тип продажи.
 */
const weighingTarget = { kind: 'document', name: 'weighing' };

/** Номера строк отвеса, из которых взяты товары продажи. */
const weighingLines = (record: SaleRecord) => record.goods.flatMap((line) => line.weighingLine ?? []);

/**
 * Проверяет связь товаров продажи со строками отвеса (раздел «Правила учёта»). Номер строки
 * отвеса допустим только у продажи с основанием, каждая строка отвеса продаётся один раз,
 * и строка должна быть «В отвесе» либо уже проданной этой же продажей: так повторное проведение
 * продажи проходит проверку.
 *
 * Проверка стоит и при записи: продавец узнает о проданном раньше товаре до проведения. При
 * проведении отвес проверяет строки ещё раз в своём действии.
 */
const checkWeighingLines = (record: SaleRecord) => Effect.gen(function* () {
    const numbers = weighingLines(record);
    if (numbers.length === 0) return;
    // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
    const basis = record.basis ?? null;
    if (basis === null) return yield* rejected('Строка отвеса указана у товара продажи без отвеса-основания');
    if (new Set(numbers).size !== numbers.length) return yield* rejected('Строка отвеса указана у нескольких товаров продажи');
    const dispatcher = yield* ActionDispatcher;
    const weighing = (yield* dispatcher.execute({ target: weighingTarget, action: 'get', payload: { guid: basis } })) as {
        readonly goods: ReadonlyArray<{ readonly name: string; readonly state: string; readonly sale: string | null }>;
    };
    for (const number of numbers) {
        const line = weighing.goods[number - 1];
        if (line === undefined) return yield* rejected(`В отвесе нет строки ${number}`);
        if (line.state !== held && line.sale !== record.guid) return yield* rejected(`Товар «${line.name}» уже не в отвесе: его состояние «${line.state}»`);
    }
});

/**
 * Отмечает строки отвеса-основания проданными этой продажей или снимает отметку. Действие отвеса
 * получает полный перечень строк продажи: строки, которые продажа больше не содержит, оно
 * возвращает в отвес. Поэтому отмена проведения передаёт пустой перечень.
 */
const applyToWeighing = (record: SaleRecord, lines: ReadonlyArray<number>) => Effect.gen(function* () {
    const basis = record.basis ?? null;
    if (basis === null) return;
    const dispatcher = yield* ActionDispatcher;
    yield* dispatcher.execute({
        target: weighingTarget, action: 'applySale',
        payload: { weighing: basis, sale: record.guid, lines: lines.map((lineNumber) => ({ lineNumber })) },
    });
});

/**
 * Продажа из отвеса меняет отвес сама: при проведении её строки становятся «Продано» и ссылаются
 * на продажу, при отмене проведения возвращаются «В отвесе». Изменение выполняется в транзакции
 * проведения: если проведение не состоится, отвес не изменится. Отвес меняет его действие
 * `applySale`, поэтому пользователю нужно право и на него.
 */
const saleWeighing: Policy<SaleRecord> = {
    name: 'sale-weighing',
    save: ({ proposedRecord }) => checkWeighingLines(proposedRecord),
    post: ({ document }) => Effect.gen(function* () {
        yield* checkWeighingLines(document);
        yield* applyToWeighing(document, weighingLines(document));
    }),
    unpost: ({ document }) => applyToWeighing(document, []),
};

/**
 * Поиск продаж для подбора: проведённые продажи без пометки удаления, новые сверху. Подбор
 * нужен полям, которые ссылаются на совершённую продажу: возврату, рассрочке по продаже,
 * строке отвеса. Черновик продажи в них выбирать незачем, поэтому подбор его не показывает.
 *
 * Строка поиска делится на слова, и продажа подходит, если каждое слово есть в её дате и времени,
 * способе оплаты, названиях товаров, сумме или номере. Сумму можно ввести с пробелами разрядов
 * и без них. Слова ищутся в тексте строки на сервере, а не запросом LIKE: LIKE в Turso различает
 * регистр кириллицы. Поэтому при поиске читаются все проведённые продажи и их товары. Для объёмов
 * магазина этого достаточно; без поиска строки страницы читаются запросом с LIMIT и OFFSET.
 */
const searchSales = ({ search, pageSize, offset }: LookupInput) => Effect.gen(function* () {
    const database = yield* Database;
    const sales = query(sale);
    const where = [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }] as const;
    const columns = ['guid', 'number', 'date', 'paymentMode', 'amount'] as const;
    const orderBy = [{ column: 'date', direction: 'DESC' }, { column: 'number', direction: 'DESC' }] as const;
    const words = normalizeSearchText('string', search).split(/\s+/u).filter((word) => word !== '');
    const found = words.length === 0
        ? yield* database.all(sales.select({ columns, where, orderBy, limit: pageSize, offset }))
        : yield* database.all(sales.select({ columns, where, orderBy }));
    // Товары читаются только у продаж, которые нужны: у страницы без поиска или у всех при поиске.
    const lines = found.length === 0 ? [] : yield* database.all(sales.tablePart('goods').select({
        columns: ['ownerGuid', 'name'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: found.map((row) => row.guid) }],
        orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
    }));
    const names = new Map<string, string[]>();
    for (const line of lines) names.set(line.ownerGuid, [...names.get(line.ownerGuid) ?? [], line.name]);
    const rows = found.map((row) => ({ guid: row.guid, number: row.number, date: row.date, paymentMode: row.paymentMode, goods: (names.get(row.guid) ?? []).join(', '), amount: row.amount }));
    // Номер нужен только поиску: колонки номера в подборе нет, и в строку ответа он не входит.
    const visible = (row: typeof rows[number]) => ({ guid: row.guid, date: row.date, paymentMode: row.paymentMode, goods: row.goods, amount: row.amount });
    if (words.length === 0) {
        const total = yield* database.get(sales.count({ where }));
        return { total: total?.total ?? 0, rows: rows.map(visible) };
    }
    const matched = rows.filter((row) => {
        // Сумма добавлена и без пробелов разрядов: «13256» и «13 256» находят одну продажу.
        const money = formatMoney(row.amount);
        const text = normalizeSearchText('string', [formatDateTime(row.date), row.paymentMode, row.goods, money, money.replace(/\s/gu, ''), String(Number(row.number))].join(' '));
        return words.every((word) => text.includes(word));
    });
    return { total: matched.length, rows: matched.slice(offset, offset + pageSize).map(visible) };
});

const target = { kind: 'document', name: 'sale' };

/**
 * Рассрочка по продаже вызывается по имени: её документ ссылается на продажу, и импорт его
 * из файла продажи замкнул бы файлы в кольцо.
 */
const installmentTarget: ObjectTarget = { kind: 'document', name: 'saleInstallment' };

/**
 * Рассрочка по продаже в данных для изменения: запись в том виде, в каком её читает действие `get`.
 * Названы только поля, которые читают действия продажи; остальные поля запись тоже содержит
 * и возвращает в рассрочку при записи без изменений.
 */
interface LinkedInstallment {
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly type: string | null;
    readonly person: string | null;
    readonly responsibleEmployee: string | null;
    readonly amount: number;
    readonly closedAt: string | null;
    readonly posted: boolean;
    readonly payments: ReadonlyArray<InstallmentPayment>;
}

/** Взнос рассрочки: строка её табличной части «Взносы». */
interface InstallmentPayment {
    readonly date: string;
    readonly method: string;
    readonly amount: number;
    readonly receiver: unknown;
    readonly shift: string | null;
}

/** Данные экрана изменения продажи: продажа, её рассрочки и версия этих данных. */
interface SaleChangesState {
    readonly sale: SaleRecord;
    /** Рассрочки по продаже без пометки удаления, по дате оформления. */
    readonly installments: ReadonlyArray<LinkedInstallment>;
    /** Версия данных: меняется при любом изменении продажи или её рассрочек, например при новом взносе. */
    readonly version: string;
}

/**
 * Хеш строки cyrb53: 53 бита, записанные шестнадцатеричным числом. Криптостойкость версии не нужна:
 * она лишь отличает изменённые данные от прежних, а сравнивает её сервер.
 */
function textHash(text: string): string {
    let first = 0xdeadbeef;
    let second = 0x41c6ce57;
    for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index);
        first = Math.imul(first ^ code, 2654435761);
        second = Math.imul(second ^ code, 1597334677);
    }
    first = Math.imul(first ^ (first >>> 16), 2246822507) ^ Math.imul(second ^ (second >>> 13), 3266489909);
    second = Math.imul(second ^ (second >>> 16), 2246822507) ^ Math.imul(first ^ (first >>> 13), 3266489909);
    return (4294967296 * (2097151 & second) + (first >>> 0)).toString(16);
}

/** Сумма взносов: сумму рассрочки нельзя сделать меньше неё. */
const paidAmount = (payments: ReadonlyArray<{ readonly amount: number }>) => payments.reduce((total, payment) => total + payment.amount, 0);

/** Взнос для сравнения: колонки по порядку, пустые как `null`. */
const paymentKey = (payment: InstallmentPayment) => JSON.stringify([payment.date, payment.method, payment.amount, payment.receiver ?? null, payment.shift ?? null]);

/** Рассрочка в тексте отказа: номер и дата, как в её представлении. */
const installmentTitle = (installment: LinkedInstallment) => `Рассрочка ${numberAndDate(installment)}`;

/** Подсказка в отказах, которые не исправить изменением: сделку отменяют целиком и оформляют заново. */
const cancellationHint = 'Чтобы изменить сделку так, используйте «Отмена продажи» и оформите продажу заново';

/**
 * Читает продажу и её рассрочки вложенными действиями `get`: чтение проверяется по правам
 * пользователя. Рассрочки отбираются запросом по описанию из метаданных: документ рассрочки
 * ссылается на продажу, и его импорт сюда замкнул бы файлы в кольцо.
 *
 * Версия — хеш продажи и рассрочек целиком, со взносами и состоянием. Экран получает её вместе
 * с данными и передаёт при записи, а запись сравнивает её с версией на момент своей транзакции:
 * так новый взнос, принятый в другой сессии, не перезаписывается устаревшими данными экрана.
 */
const changesState = (guid: string) => Effect.gen(function* () {
    const dispatcher = yield* ActionDispatcher;
    const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid } })) as SaleRecord;
    const metadata = yield* Metadata;
    const description = metadata.find('document', installmentTarget.name);
    if (description === undefined) return yield* Effect.die(new Error('В конфигурации нет документа «Рассрочка по продаже»'));
    const database = yield* Database;
    const rows = yield* database.all(query(description).select({
        columns: ['guid'],
        where: [{ column: 'sale', operator: '=', value: guid }, { column: 'deletedAt', operator: '=', value: null }],
        orderBy: [{ column: 'date', direction: 'ASC' }, { column: 'number', direction: 'ASC' }],
    }));
    const installments: LinkedInstallment[] = [];
    for (const row of rows) installments.push((yield* dispatcher.execute({ target: installmentTarget, action: 'get', payload: { guid: row['guid'] } })) as LinkedInstallment);
    const state: SaleChangesState = { sale: record, installments, version: textHash(JSON.stringify([record, installments])) };
    return state;
});

/** Изменение рассрочки из входных данных «Внести изменения». */
interface InstallmentChange {
    readonly installment: string;
    readonly type?: string | null | undefined;
    readonly amount: number;
    readonly person?: string | null | undefined;
    readonly responsibleEmployee?: string | null | undefined;
}

/** Взнос из входных данных «Внести изменения»: строка с рассрочкой, к которой он относится. */
interface PaymentChange {
    readonly installment: string;
    readonly date: string;
    readonly method: string;
    readonly amount: number;
    readonly receiver?: unknown;
    readonly shift?: string | null | undefined;
}

/** Рассрочка, которую «Внести изменения» записывает, и её новые значения. */
interface InstallmentWrite {
    readonly existing: LinkedInstallment;
    readonly fields: Pick<LinkedInstallment, 'amount' | 'person' | 'responsibleEmployee' | 'payments'>;
}

/**
 * Новые взносы рассрочки из входных данных. Взнос без смены получает открытую смену, как при
 * действии «Внести»: так добавленный на экране взнос учитывается в смене, которая его приняла.
 * Прежний взнос без смены остаётся без неё: совпадающая строка прежних взносов сопоставляется
 * с ним и смену не получает.
 */
const proposedPayments = (existing: LinkedInstallment, rows: ReadonlyArray<PaymentChange>, openShift: string | null): InstallmentPayment[] => {
    const withoutShift = existing.payments.filter((payment) => (payment.shift ?? null) === null).map(paymentKey);
    return rows.map((row) => {
        // Необязательное поле, не переданное в запросе, приходит в действие как `undefined`, а запись принимает `null`.
        const payment = { date: row.date, method: row.method, amount: row.amount, receiver: row.receiver ?? null, shift: row.shift ?? null };
        if (payment.shift !== null) return payment;
        const index = withoutShift.indexOf(paymentKey(payment));
        if (index !== -1) {
            withoutShift.splice(index, 1);
            return payment;
        }
        return { ...payment, shift: openShift };
    });
};

/**
 * Проверяет изменения рассрочек (раздел «Правила редактирования продаж») и возвращает рассрочки,
 * которые нужно записать. Входные данные перечисляют каждую рассрочку продажи ровно один раз:
 * рассрочку нельзя убрать из продажи или добавить чужую. Тип не меняется, сумма не меньше
 * взносов, закрытая рассрочка не меняется вовсе.
 *
 * Взносы перечислены отдельными строками со ссылкой на рассрочку: у рассрочки без строк взносов
 * нет. Взносы непроведённой рассрочки не меняются: как и действие «Внести», запись их не принимает,
 * пока рассрочка не проведена и не учитывает долг. Предел взносов дополнительно проверяет
 * ограничение регистра «Долги по рассрочкам», даты взносов — политика закрытого периода.
 */
const checkInstallmentChanges = (state: SaleChangesState, changes: ReadonlyArray<InstallmentChange>, paymentRows: ReadonlyArray<PaymentChange>) => Effect.gen(function* () {
    const given = new Map(changes.map((change) => [change.installment, change]));
    if (given.size !== changes.length) return yield* rejected('Рассрочка указана в изменениях несколько раз');
    const known = new Set(state.installments.map((installment) => installment.guid));
    if (changes.some((change) => !known.has(change.installment))) return yield* rejected('В изменениях указана рассрочка, которая не относится к этой продаже');
    if (paymentRows.some((row) => !given.has(row.installment))) return yield* rejected('Взнос указан у рассрочки, которой нет в изменениях');
    const database = yield* Database;
    const shift = yield* database.get(query(Shift).select({ columns: ['guid'], where: [{ column: 'closedAt', operator: '=', value: null }], limit: 1 }));
    const writes: InstallmentWrite[] = [];
    for (const existing of state.installments) {
        const change = given.get(existing.guid);
        if (change === undefined) return yield* rejected(`${installmentTitle(existing)} не указана в изменениях: убрать рассрочку из продажи нельзя. ${cancellationHint}`);
        // Необязательное поле, не переданное в запросе, приходит в действие как `undefined`.
        if ((change.type ?? null) !== (existing.type ?? null)) return yield* rejected(`${installmentTitle(existing)}: тип рассрочки менять нельзя. ${cancellationHint}`);
        const payments = proposedPayments(existing, paymentRows.filter((row) => row.installment === existing.guid), shift?.guid ?? null);
        const paymentsChanged = JSON.stringify(payments.map(paymentKey)) !== JSON.stringify(existing.payments.map(paymentKey));
        if (paymentsChanged && !existing.posted) return yield* rejected(`${installmentTitle(existing)} не проведена: её взносы изменить нельзя`);
        const paid = paidAmount(payments);
        if (change.amount < paid) return yield* rejected(`${installmentTitle(existing)}: сумма ${rubles(change.amount)} меньше взносов ${rubles(paid)}`);
        const fields = { amount: change.amount, person: change.person ?? null, responsibleEmployee: change.responsibleEmployee ?? null, payments };
        const changed = paymentsChanged || fields.amount !== existing.amount || fields.person !== (existing.person ?? null) || fields.responsibleEmployee !== (existing.responsibleEmployee ?? null);
        if (!changed) continue;
        if (existing.closedAt !== null) return yield* rejected(`${installmentTitle(existing)} закрыта, изменить её нельзя. ${cancellationHint}`);
        writes.push({ existing, fields });
    }
    return writes;
});

/** Условия новой рассрочки: те же, что запрашивает «Продать с рассрочкой». */
interface InstallmentTerms {
    readonly type: string;
    readonly person: string;
    readonly responsibleEmployee?: string | null | undefined;
    readonly rate?: string | null | undefined;
    readonly initialMethod?: string | null | undefined;
    readonly initialAmount?: number | null | undefined;
    readonly initialReceiver?: unknown;
}

/**
 * Оформляет и проводит рассрочку по проведённой продаже на сумму `amount` (раздел «Правила учёта»).
 * Общая часть действий «Продать с рассрочкой» и «Внести изменения»: рассрочка всегда создаётся
 * с типом, покупателем и ставкой, а не черновиком без них.
 *
 * Первоначальный взнос допустим только у собственной рассрочки и меньше её суммы: банковскую
 * банк оплачивает целиком, а при оплате всей суммы рассрочка не нужна. Взнос и рассрочка
 * относятся к смене продажи. Собственная рассрочка проводится и остаётся открытой, банковскую
 * проводит и закрывает действие рассрочки «Оплата банком».
 */
const arrangeInstallment = (record: SaleRecord, amount: number, terms: InstallmentTerms) => Effect.gen(function* () {
    const dispatcher = yield* ActionDispatcher;
    // Необязательные поля, не переданные в запросе, приходят в действие как `undefined`.
    const initialAmount = terms.initialAmount ?? null;
    // Отказ, а не пропуск взноса, сообщает вызывающему, что сумма не учтена.
    if (initialAmount !== null && terms.type !== ownInstallment) {
        return yield* rejected('Банковской рассрочке первоначальный взнос не нужен: банк оплачивает её целиком');
    }
    if (initialAmount !== null && initialAmount >= amount) {
        return yield* rejected(`Первоначальный взнос должен быть меньше суммы рассрочки ${rubles(amount)}: при оплате всей суммы рассрочка не нужна`);
    }
    const rate = terms.type === ownInstallment ? yield* ownInstallmentRate : terms.rate ?? null;
    // Первоначальный взнос — обычный взнос рассрочки, принятый в момент оформления: его деньги
    // приняла смена продажи, и регистр «Поступления денег» получит их по способу взноса.
    const now = new Date().toISOString();
    const payments = initialAmount === null ? [] : [{
        date: now, method: terms.initialMethod ?? cash, amount: initialAmount,
        receiver: terms.initialReceiver ?? null, shift: record.shift,
    }];
    // Рассрочка относится к смене продажи: долг покупателя выдаёт смена, которая продала товар.
    const installment = (yield* dispatcher.execute({
        target: installmentTarget, action: 'save',
        payload: {
            fields: {
                date: now, sale: record.guid, shift: record.shift, amount, payments,
                type: terms.type, person: terms.person, rate,
                responsibleEmployee: terms.responsibleEmployee ?? null,
            },
        },
    })) as { readonly guid: string };
    yield* dispatcher.execute({ target: installmentTarget, action: terms.type === ownInstallment ? 'post' : 'settleByBank', payload: terms.type === ownInstallment ? { guid: installment.guid } : { installment: installment.guid } });
});

/** Записывает рассрочку с новыми значениями вложенным `save`: запись проведённой рассрочки проводит её заново. */
const writeInstallment = ({ existing, fields }: InstallmentWrite) => Effect.gen(function* () {
    const dispatcher = yield* ActionDispatcher;
    yield* dispatcher.execute({ target: installmentTarget, action: 'save', payload: { guid: existing.guid, fields: { ...existing, ...fields } } });
});

/**
 * Основание на форме скрыто и показано элементом `SaleBasis` ссылкой: его заполняет только
 * действие отвеса, и поле ввода позволило бы привязать продажу к чужому отвесу. Флажок «Проведён»
 * скрыт: проведение показывает отметка в заголовке формы.
 *
 * Способ оплаты на форме выбирает элемент `SalePaymentMode`, оплаты показывает элемент
 * `SalePayments`: при простом способе это сумма и «Куда оплачено», при сложном полная таблица.
 *
 * Неоформленную сумму рассрочки показывает элемент `SaleInstallmentArrangement`; он же выводит
 * кнопку действия «Оформить рассрочку» и передаёт ему `guid` продажи. Стандартную кнопку действия
 * элемент скрывает: её окно потребовало бы выбрать продажу.
 *
 * Рассрочку создаёт действие на сервере, а не форма новой рассрочки: сумма берётся из итога
 * регистра в той же транзакции, и форма не может подставить устаревшую.
 *
 * Действие «Продать с рассрочкой» проводит продажу и сразу оформляет и проводит рассрочку по ней
 * на сумму оплат способом «Рассрочка» с типом, покупателем и ответственным из входных данных.
 * Всё выполняется в одной транзакции: если рассрочка не проведётся, например без ответственного
 * у собственной рассрочки, проведение продажи тоже отменится. Рассрочку и первоначальный взнос
 * оформляет `arrangeInstallment`. Права нужны те же, что у вложенных
 * действий: проведение продажи, запись и проведение рассрочки по продаже. Рассрочка записывается
 * вложенным `save`, а оно проверяется по правам того же пользователя, поэтому пользователю нужны
 * права на действие, на чтение продажи и на запись рассрочки по продаже.
 */
export const Sale = sale
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Продажа', ['number', 'date', 'shift'])
        .group('Товары', ['goods', 'amount'])
        .group('Оплата', ['paymentMode', 'payments', 'paid'])
        .hide('basis')
        .hide('posted'))
    .policy(salePayments)
    .policy(saleAmount)
    .policy(saleWeighing)
    // Продажа закрытого периода вошла в зафиксированное начисление зарплаты и больше не меняется.
    .policy(closedPeriodByDocumentDate())
    // Подбор показывает продажу развёрнуто, а представление в ссылках и вкладках остаётся коротким.
    .lookup((lookup) => lookup
        .column('date', (field) => field.dateTime().title('Дата').required())
        .column('paymentMode', (field) => field.string().title('Оплата').required())
        .column('goods', (field) => field.string().title('Товары').required())
        .column('amount', (field) => field.money().title('Сумма').required())
        .search(searchSales))
    .action('createInstallment', (action) => action
        .title('Оформить рассрочку')
        .input((input) => input.field('sale', (field) => field.reference(sale).title('Продажа').required()))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.sale } })) as SaleRecord;
            // Итог есть только у проведённой продажи: непроведённая движений не записала.
            if (!record.posted) return yield* rejected('Продажа не проведена: сначала проведите её, чтобы оформить рассрочку');
            // Итог регистра по продаже считается запросом в транзакции действия. Запрос собран
            // конструктором SQL, а не функцией итогов платформы: её модуль тянет серверный код
            // в проверку типов клиента, который читает тип продажи.
            const database = yield* Database;
            const total = yield* database.get(query(UnarrangedInstallments).sums({
                groupBy: [],
                sums: ['amount'],
                where: [{ column: 'sale', operator: '=', value: record.guid }],
            }));
            const amount = total?.amount ?? 0;
            if (amount <= 0) return yield* rejected('По продаже нет суммы, на которую рассрочка ещё не оформлена');
            // Рассрочка относится к смене, в которую её оформили, а не к смене продажи: продажа уже
            // записала свою сумму в свою смену, а долг покупателя выдаёт смена, оформившая рассрочку.
            const shift = yield* database.get(query(Shift).select({
                columns: ['guid'],
                where: [{ column: 'closedAt', operator: '=', value: null }],
                limit: 1,
            }));
            if (shift === undefined) return yield* rejected('Нет открытой смены: откройте смену, чтобы оформить рассрочку');
            // Физическое лицо берётся из отвеса-основания: покупателя продавец уже ввёл в отвесе.
            // Необязательное поле, не переданное в запросе, приходит как `undefined`, а не `null`.
            const basis = record.basis ?? null;
            const person = basis === null ? null : ((yield* dispatcher.execute({ target: weighingTarget, action: 'get', payload: { guid: basis } })) as { readonly person: string }).person;
            // Рассрочка создаётся непроведённой: тип и ответственного продавец заполняет в ней сам,
            // а физическое лицо, если продажа не из отвеса. До проведения итог регистра она не уменьшает.
            return yield* dispatcher.execute({
                target: { kind: 'document', name: 'saleInstallment' }, action: 'save',
                payload: { fields: { date: new Date().toISOString(), sale: record.guid, shift: shift.guid, amount, payments: [], person } },
            });
        })))
    .action('sellWithInstallment', (action) => action
        .title('Продать с рассрочкой')
        .input((input) => input
            .field('sale', (field) => field.reference(sale).title('Продажа').required())
            .field('type', (field) => field.string().title('Тип рассрочки').choices(installmentTypes).required())
            .field('person', (field) => field.reference(PhysicalPersons).title('Покупатель').required().width('free'))
            .field('responsibleEmployee', (field) => field.reference(Employees).title('Ответственный сотрудник').width('long'))
            // Ставку выбирают у банковской рассрочки; собственной действие проставляет ставку «Собственная» само.
            .field('rate', (field) => field.reference(InstallmentRates).title('Ставка рассрочки'))
            // Первоначальный взнос необязателен: без суммы рассрочка оформляется без взносов.
            .field('initialMethod', (field) => field.string().title('Способ взноса').choices(paymentMethods).initial(cash))
            .field('initialAmount', (field) => field.money().title('Первоначальный взнос').minimum(1))
            .field('initialReceiver', receiverField))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.sale } })) as SaleRecord;
            const amount = installmentAmount(record);
            if (amount <= 0) return yield* rejected(`В продаже нет оплаты способом «${installmentMethod}»: проведите её без рассрочки`);
            // Продажа проводится первой: рассрочка оформляется на итог регистра, который пишет её проведение.
            const posted = yield* dispatcher.execute({ target, action: 'post', payload: { guid: record.guid } });
            yield* arrangeInstallment(record, amount, input);
            return posted;
        })))
    .action('changesState', (action) => action
        .title('Данные для изменения')
        // Данные читает экран «Внести изменения» сам: кнопка на форме не нужна.
        .placement('hidden')
        .input((input) => input.field('sale', (field) => field.reference(sale).title('Продажа').required()))
        .handle((input) => changesState(input.sale)))
    .action('saveChanges', (action) => action
        .title('Внести изменения')
        // Действие выполняет кнопка экрана изменения: входные данные собирает он.
        .placement('hidden')
        .input((input) => input
            .field('sale', (field) => field.reference(sale).title('Продажа').required())
            .field('version', (field) => field.string().title('Версия данных').maximumLength(50).required())
            .field('paymentMode', (field) => field.string().title('Способ оплаты').choices([...paymentMethods, installmentMethod, complexPayment]).required())
            // Условия новой рассрочки: заполняются, когда оплату «Рассрочка» не покрывают оформленные рассрочки.
            .field('newInstallmentType', (field) => field.string().title('Тип новой рассрочки').choices(installmentTypes))
            .field('newInstallmentPerson', (field) => field.reference(PhysicalPersons).title('Покупатель'))
            .field('newInstallmentResponsibleEmployee', (field) => field.reference(Employees).title('Ответственный сотрудник'))
            .field('newInstallmentRate', (field) => field.reference(InstallmentRates).title('Ставка рассрочки'))
            .field('newInstallmentInitialMethod', (field) => field.string().title('Способ взноса').choices(paymentMethods))
            .field('newInstallmentInitialAmount', (field) => field.money().title('Первоначальный взнос').minimum(1))
            .field('newInstallmentInitialReceiver', receiverField)
            .tablePart('goods', (part) => part.title('Товары').include(Goods)
                .field('weighingLine', (field) => field.number().title('Строка отвеса').integer().minimum(1)))
            .tablePart('payments', (part) => part.title('Оплаты').include(paymentColumns([...paymentMethods, installmentMethod])))
            .tablePart('installments', (part) => part.title('Рассрочки')
                .field('installment', (field) => field.reference((): ObjectTarget => installmentTarget).title('Рассрочка').required())
                .field('type', (field) => field.string().title('Тип').choices(installmentTypes))
                .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
                .field('person', (field) => field.reference(PhysicalPersons).title('Физическое лицо'))
                .field('responsibleEmployee', (field) => field.reference(Employees).title('Ответственный сотрудник')))
            // Взносы всех рассрочек одной частью: строка ссылается на свою рассрочку, потому что
            // табличная часть входных данных не содержит вложенных частей.
            .tablePart('installmentPayments', (part) => part.title('Взносы рассрочек')
                .field('installment', (field) => field.reference((): ObjectTarget => installmentTarget).title('Рассрочка').required())
                .field('date', (field) => field.dateTime().title('Дата').required())
                .include(Payments)
                .field('shift', (field) => field.reference(Shift).title('Смена'))))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const state = yield* changesState(input.sale);
            // Версия сравнивается до любых записей: при расхождении ничего не меняется, а экран
            // перечитывает данные и сохраняет введённое.
            if (state.version !== input.version) {
                return yield* rejected('Продажа или её рассрочки изменились после открытия экрана, например принят новый взнос. Расчёт обновлён: проверьте его и сохраните снова');
            }
            const record = state.sale;
            if (record.deletedAt !== null) return yield* rejected('Продажа помечена на удаление, изменить её нельзя');
            if (!record.posted) return yield* rejected('Продажа не проведена: измените её на форме и проведите');
            const proposed: SaleRecord = { ...record, paymentMode: input.paymentMode, goods: input.goods, payments: input.payments };
            const line = installmentAmount(proposed);
            if (state.installments.length > 0 && line <= 0) {
                return yield* rejected(`У продажи есть рассрочки, поэтому в оплате должна остаться оплата способом «${installmentMethod}». ${cancellationHint}`);
            }
            const writes = yield* checkInstallmentChanges(state, input.installments, input.installmentPayments);
            // Итог регистра «Неоформленные рассрочки» учитывает только проведённые рассрочки.
            const arranged = state.installments.filter((installment) => installment.posted)
                .reduce((total, installment) => total + (writes.find((write) => write.existing.guid === installment.guid)?.fields.amount ?? installment.amount), 0);
            if (arranged > line) {
                return yield* rejected(`Сумма рассрочек ${rubles(arranged)} больше оплаты способом «${installmentMethod}» ${rubles(line)}`);
            }
            // Неоформленная до изменения сумма может остаться или уменьшиться, но не вырасти: иначе
            // рассрочку на неё создал бы черновик «Оформить рассрочку» без типа и покупателя. Прирост
            // оплаты «Рассрочка», который не распределён по рассрочкам, получает новая рассрочка
            // с условиями из входных данных, как при продаже с рассрочкой.
            const unarrangedBefore = Math.max(0, installmentAmount(record) - state.installments.filter((installment) => installment.posted).reduce((total, installment) => total + installment.amount, 0));
            const newAmount = line - arranged - unarrangedBefore;
            const newType = input.newInstallmentType ?? null;
            const newPerson = input.newInstallmentPerson ?? null;
            if (newAmount > 0 && (newType === null || newPerson === null)) {
                return yield* rejected(`Оплата способом «${installmentMethod}» больше суммы рассрочек на ${rubles(newAmount)}: укажите тип и покупателя новой рассрочки или распределите изменение по рассрочкам`);
            }
            if (newAmount <= 0 && newType !== null) {
                return yield* rejected(`Новая рассрочка не нужна: оплата способом «${installmentMethod}» распределена по рассрочкам`);
            }
            // Ограничения регистров проверяются после каждой записи, поэтому порядок записей
            // не допускает промежуточного нарушения: сначала уменьшаются рассрочки, затем
            // записывается продажа, затем увеличиваются остальные рассрочки.
            const decreased = writes.filter((write) => write.fields.amount < write.existing.amount);
            for (const write of decreased) yield* writeInstallment(write);
            yield* dispatcher.execute({ target, action: 'save', payload: { guid: record.guid, fields: proposed } });
            for (const write of writes.filter((candidate) => !decreased.includes(candidate))) yield* writeInstallment(write);
            // Новая рассрочка оформляется последней: на её сумму оплата «Рассрочка» уже записана продажей.
            if (newAmount > 0 && newType !== null && newPerson !== null) {
                yield* arrangeInstallment(proposed, newAmount, {
                    type: newType, person: newPerson, responsibleEmployee: input.newInstallmentResponsibleEmployee, rate: input.newInstallmentRate,
                    initialMethod: input.newInstallmentInitialMethod, initialAmount: input.newInstallmentInitialAmount, initialReceiver: input.newInstallmentInitialReceiver,
                });
            }
            return yield* dispatcher.execute({ target, action: 'get', payload: { guid: record.guid } });
        })))
    .action('cancel', (action) => action
        .title('Отмена продажи')
        .placement('more')
        .confirmation({
            delay: 3,
            tone: 'danger',
            title: 'Отменить продажу?',
            message: 'Продажа, её рассрочки и принятые в них взносы перестанут учитываться: документы будут помечены на удаление. Записи и журнал действий сохранятся.',
        })
        .input((input) => input.field('sale', (field) => field.reference(sale).title('Продажа').required()))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const state = yield* changesState(input.sale);
            if (state.sale.deletedAt !== null) return yield* rejected('Продажа уже помечена на удаление');
            // Сначала снимаются движения рассрочек: пока они проведены, отмена проведения продажи
            // нарушила бы ограничение регистра «Неоформленные рассрочки». Проведение отменяется
            // явным действием, а не пометкой удаления: так срабатывают политики отмены проведения.
            for (const installment of state.installments) {
                if (installment.posted) yield* dispatcher.execute({ target: installmentTarget, action: 'unpost', payload: { guid: installment.guid } });
            }
            // Отмена проведения продажи возвращает товары в отвес-основание.
            if (state.sale.posted) yield* dispatcher.execute({ target, action: 'unpost', payload: { guid: state.sale.guid } });
            yield* dispatcher.execute({ target, action: 'markDeleted', payload: { guid: state.sale.guid } });
            // Закрытая рассрочка помечается на удаление только после пометки продажи: так её политика
            // видит, что основание отменено.
            for (const installment of state.installments) yield* dispatcher.execute({ target: installmentTarget, action: 'markDeleted', payload: { guid: installment.guid } });
            return yield* dispatcher.execute({ target, action: 'get', payload: { guid: state.sale.guid } });
        })))
    // Проведение объявлено последним: его обработчик ссылается на регистр «Продажи за вычетом возвратов», а тот читает
    // продажу в тексте отказа. У последнего вызова цепочки компилятор берёт тип результата без
    // разбора обработчика, поэтому тип продажи не выводится через тип регистра и обратно.
    .posting((record) => Effect.succeed([
        movements(SalesNetOfReturns, [{ sale: record.guid, shift: record.shift, amount: record.amount }]),
        // Движение на каждую оплату деньгами со сменой продажи: итог смены по способу складывается из них.
        movements(MoneyReceipts, record.payments.filter((payment) => !byInstallment(payment)).map((payment) => ({ shift: record.shift, method: payment.method, amount: payment.amount }))),
        // Оплаты способом «Рассрочка» записаны одной суммой: рассрочки оформляются на продажу, а не на строку.
        movements(UnarrangedInstallments, installmentAmount(record) > 0 ? [{ sale: record.guid, amount: installmentAmount(record) }] : []),
    ]));
