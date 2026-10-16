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
import { document, formula, movements, type LookupInput, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { formatDateTime, formatMoney, normalizeSearchText } from '../../server/ui/value-format.js';
import { Employees } from '../catalogs/employees.catalog.js';
import { InstallmentRates } from '../catalogs/installment-rates.catalog.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { Goods } from '../goods.js';
import { installmentTypes, ownInstallment, ownInstallmentRate } from '../installments.js';
import { rubles } from '../money.js';
import { cash, installmentMethod, paymentColumns, paymentMethods } from '../payments.js';
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
const installmentTarget = { kind: 'document', name: 'saleInstallment' };

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
 * у собственной рассрочки, проведение продажи тоже отменится. Права нужны те же, что у вложенных
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
            .field('rate', (field) => field.reference(InstallmentRates).title('Ставка рассрочки')))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.sale } })) as SaleRecord;
            const amount = installmentAmount(record);
            if (amount <= 0) return yield* rejected(`В продаже нет оплаты способом «${installmentMethod}»: проведите её без рассрочки`);
            const rate = input.type === ownInstallment ? yield* ownInstallmentRate : input.rate ?? null;
            // Продажа проводится первой: рассрочка оформляется на итог регистра, который пишет её проведение.
            const posted = yield* dispatcher.execute({ target, action: 'post', payload: { guid: record.guid } });
            // Рассрочка относится к смене продажи: её оформляют в момент продажи, и выдаёт долг та же смена.
            const installment = (yield* dispatcher.execute({
                target: installmentTarget, action: 'save',
                payload: {
                    fields: {
                        date: new Date().toISOString(), sale: record.guid, shift: record.shift, amount, payments: [],
                        type: input.type, person: input.person, rate,
                        // Необязательное поле, не переданное в запросе, приходит в действие как `undefined`, а запись принимает `null`.
                        responsibleEmployee: input.responsibleEmployee ?? null,
                    },
                },
            })) as { readonly guid: string };
            yield* dispatcher.execute({ target: installmentTarget, action: 'post', payload: { guid: installment.guid } });
            return posted;
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
