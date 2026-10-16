/**
 * Общее описание рассрочки по продаже: долг покупателя, который он гасит взносами. Здесь
 * объявлены поля, взносы, политика, проведение и действия «Внести» и «Закрыть»; документ
 * `sale-installment.document.ts` добавляет сумму, ссылку на продажу и собственные движения.
 *
 * У рассрочки два состояния, открыта и закрыта; закрытая не изменяется и взносов не принимает.
 * Остаток хранится вычисляемым полем шапки: по нему работают блок незакрытых рассрочек и условие
 * закрытия. Проведённая рассрочка записывает в регистр «Долги по рассрочкам» свою сумму
 * и взносы, а в регистр «Поступления денег» каждый взнос по его способу.
 */
import { Effect } from 'effect';
import { requireRight } from '../server/authorization/current-user-rights.js';
import { ActionDispatcher } from '../server/data/action-context.js';
import { DataPolicyError } from '../server/data/data.errors.js';
import { query } from '../server/database/sql.builder.js';
import { Database } from '../server/database/database.effect.js';
import {
    document,
    formula,
    movements,
    objectReference,
    type DocumentBuilder,
    type FieldFactory,
    type ObjectRecord,
    type ObjectTarget,
    type Policy,
    type RecordOf,
    type RegisterMovements,
    type TablePartMap,
} from '../server/metadata/index.js';
import { Employees } from './catalogs/employees.catalog.js';
import { PhysicalPersons } from './catalogs/physical-persons.catalog.js';
import { Rights } from './configuration.generated.js';
import { Shift } from './documents/shift.document.js';
import { rubles } from './money.js';
import { closedPeriodPolicy } from './policies/closed-period.js';
import { paymentMethods, Payments, receiverField } from './payments.js';
import { InstallmentDebts } from './registers/installment-debts.register.js';
import { MoneyReceipts } from './registers/money-receipts.register.js';

/** Имя документа-рассрочки. По нему из `Rights` берётся право закрытия. */
type InstallmentName = 'saleInstallment';

/** Рассрочка, за которую отвечает магазин: у неё обязателен ответственный сотрудник. */
export const ownInstallment = 'Собственная';

/**
 * Типы рассрочки: банковская оформляется через банк, собственную магазин ведёт сам. Объявлены
 * отдельно: тот же выбор запрашивает действие продажи «Продать с рассрочкой».
 */
export const installmentTypes = ['Банковская', ownInstallment];

/**
 * Начало шапки: поля до суммы. Сумму объявляет документ.
 *
 * Тип и физическое лицо у поля необязательны: рассрочку по продаже создаёт действие продажи,
 * и заполняет их продавец уже в созданном документе. Когда они обязательны, решает политика.
 */
const head = <const Name extends InstallmentName>(name: Name, title: string) => document(name)
    .title(title)
    .field('type', (field) => field.string().title('Тип').choices(installmentTypes))
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    .field('person', (field) => field.reference(PhysicalPersons).title('Физическое лицо').width('free'))
    .field('responsibleEmployee', (field) => field.reference(Employees).title('Ответственный сотрудник').width('long'));

type HeadBuilder<Name extends InstallmentName> = ReturnType<typeof head<Name>>;
type HeadFields = HeadBuilder<InstallmentName>['~fields'];

/** Сумма рассрочки: обязательные деньги. Формулу или ввод задаёт документ. */
const amountField = (field: FieldFactory) => field.money().required();
type AmountField = { readonly amount: ReturnType<typeof amountField> };

/**
 * Конец шапки и взносы: поля после суммы. Взнос хранит общие колонки оплат, дату и смену,
 * в которую его приняли. Смена необязательна: взнос принимается и без открытой смены.
 */
const tail = <Name extends InstallmentName>(base: DocumentBuilder<Name, HeadFields & AmountField, {}>) => base
    .field('balance', (field) => field.money().title('Остаток').required().computed(formula.subtract(formula.field('amount'), formula.sum('payments', 'amount'))))
    .field('closedAt', (field) => field.dateTime().title('Закрыта'))
    .tablePart('payments', (part) => part
        .title('Взносы')
        .field('date', (field) => field.dateTime().title('Дата').required())
        .include(Payments)
        .field('shift', (field) => field.reference(Shift).title('Смена')));

type TailBuilder = ReturnType<typeof tail<InstallmentName>>;

/** Запись рассрочки с общими полями. */
type InstallmentRecord = RecordOf<TailBuilder>;

const rejected = (message: string) => new DataPolicyError({ message });

const closedRejection = 'Рассрочка закрыта, изменить её нельзя';

const notPosted = 'Рассрочка не проведена: сначала проведите её';

/**
 * Тип и физическое лицо нужны движениям и отчётам, поэтому без них рассрочка не проводится.
 */
const checkCustomer = (record: InstallmentRecord) => {
    // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
    if ((record.type ?? null) === null) return Effect.fail(rejected('Укажите тип рассрочки'));
    if ((record.person ?? null) === null) return Effect.fail(rejected('Укажите физическое лицо рассрочки'));
    return Effect.void;
};

/** Момент значения даты со временем: строки хранятся с часовым поясом клиента, и их сравнение дало бы неверный порядок. */
const moment = (value: string): number => new Date(value).getTime();

/**
 * Дата последнего взноса рассрочки; без взносов `null`. Так же её считает форма рассрочки,
 * когда предлагает дату закрытия: рассрочка погашена этим взносом.
 */
const lastPaymentDate = (payments: ReadonlyArray<{ readonly date: string }>): string | null =>
    payments.reduce<string | null>((latest, payment) => latest === null || moment(payment.date) > moment(latest) ? payment.date : latest, null);

/**
 * Дата закрытия задаётся пользователем, а не берётся текущей: собственная рассрочка начисляется
 * в зарплату периодом закрытия, и закрыть погашенную рассрочку нужно датой, когда её погасили.
 * Поэтому дата не раньше последнего взноса и даты рассрочки и не позже текущего момента:
 * раньше погашения рассрочка закрыта быть не могла, а будущей датой событие ещё не наступило.
 */
const checkClosingDate = (record: InstallmentRecord) => {
    const closedAt = moment(record.closedAt!);
    const latest = lastPaymentDate(record.payments);
    if (latest !== null && closedAt < moment(latest)) return Effect.fail(rejected('Дата закрытия раньше последнего взноса'));
    if (closedAt < moment(record.date)) return Effect.fail(rejected('Дата закрытия раньше даты рассрочки'));
    if (closedAt > Date.now()) return Effect.fail(rejected('Дата закрытия ещё не наступила'));
    return Effect.void;
};

/** Поля шапки, изменение которых меняет рассрочку целиком, а не её взносы или закрытие. */
const headFields = ['date', 'type', 'shift', 'person', 'responsibleEmployee', 'amount', 'sale'] as const;

/** Значения поля для сравнения: необязательное поле, не переданное в запросе, приходит как `undefined`. */
const comparable = (value: unknown): string => JSON.stringify(value ?? null);

/** Строка взноса для сравнения: колонки по порядку, пустые как `null`. */
const paymentKey = (payment: InstallmentRecord['payments'][number]): string =>
    comparable([payment.date, payment.method, payment.amount, payment.receiver, payment.shift]);

/** Все даты учёта рассрочки: её дата, даты взносов и дата закрытия. */
const installmentDates = (record: InstallmentRecord): string[] => [
    record.date,
    ...record.payments.map((payment) => payment.date),
    ...(record.closedAt ?? null) === null ? [] : [record.closedAt!],
];

/**
 * Даты, которые затрагивает запись рассрочки: только у изменённых частей. Рассрочка из закрытого
 * периода продолжает принимать взносы, поэтому новый взнос проверяется своей датой, а прежние
 * взносы и дата рассрочки не проверяются, пока не изменились. Изменение шапки затрагивает дату
 * рассрочки до и после записи; добавленный или удалённый взнос — свою дату; закрытие — свою.
 */
const changedInstallmentDates = (existingRecord: InstallmentRecord | null, proposedRecord: InstallmentRecord): string[] => {
    if (existingRecord === null) return installmentDates(proposedRecord);
    const fields = (record: InstallmentRecord) => record as unknown as Record<string, unknown>;
    const headChanged = headFields.some((name) => comparable(fields(existingRecord)[name]) !== comparable(fields(proposedRecord)[name]));
    const dates = headChanged ? [existingRecord.date, proposedRecord.date] : [];
    // Взносы сравниваются как мультимножества: совпавшие строки взаимно вычёркиваются.
    const remaining = existingRecord.payments.map((payment) => ({ key: paymentKey(payment), date: payment.date }));
    for (const payment of proposedRecord.payments) {
        const index = remaining.findIndex((candidate) => candidate.key === paymentKey(payment));
        if (index === -1) dates.push(payment.date);
        else remaining.splice(index, 1);
    }
    // Оставшиеся строки прежней записи удалены или изменены: их даты тоже затронуты.
    dates.push(...remaining.map((payment) => payment.date));
    const existingClosedAt = existingRecord.closedAt ?? null;
    const proposedClosedAt = proposedRecord.closedAt ?? null;
    if (existingClosedAt !== proposedClosedAt) dates.push(...[existingClosedAt, proposedClosedAt].filter((date): date is string => date !== null));
    return dates;
};

/**
 * Правила рассрочки (раздел «Правила учёта»).
 *
 * Запись с датой закрытия политика не отличает от закрытия действием «Закрыть»: так рассрочку
 * закрывает само действие. Поэтому условие закрытия и право на него проверяются здесь.
 * Ответственный обязателен только у собственной рассрочки, в том числе при вложенной записи
 * взноса или закрытия. `Rights` читается при выполнении: при загрузке документа реестр ещё не готов.
 * Предел взносов политика не проверяет: его задаёт ограничение регистра «Долги по рассрочкам».
 */
const installmentRules = (name: InstallmentName): Policy<InstallmentRecord> => ({
    name: 'installment-rules',
    save: ({ existingRecord, proposedRecord }) => Effect.gen(function* () {
        if (existingRecord !== null && existingRecord.closedAt !== null) return yield* rejected(closedRejection);
        const closes = (existingRecord?.closedAt ?? null) === null && (proposedRecord.closedAt ?? null) !== null;
        if (closes) yield* requireRight(Rights.document[name].actions.close);
        // Рассрочку по продаже действие продажи создаёт без типа и физического лица, поэтому
        // её черновик записывается без них.
        if (proposedRecord.posted) yield* checkCustomer(proposedRecord);
        if (proposedRecord.type === ownInstallment && (proposedRecord.responsibleEmployee ?? null) === null) {
            return yield* rejected('Укажите ответственного сотрудника собственной рассрочки');
        }
        if ((proposedRecord.closedAt ?? null) !== null && proposedRecord.balance !== 0) {
            return yield* rejected(`Рассрочку можно закрыть, только когда остаток равен нулю, а он равен ${rubles(proposedRecord.balance)}`);
        }
        if (closes) yield* checkClosingDate(proposedRecord);
    }),
    post: ({ document: record }) => checkCustomer(record),
    markDeleted: ({ record }) => record.closedAt === null ? Effect.void : Effect.fail(rejected(closedRejection)),
});

/**
 * Строит документ-рассрочку из общего описания. `extend` получает начало шапки и объявляет сумму
 * `amount` и собственные поля и табличные части документа; после них функция добавляет остаток,
 * дату закрытия, взносы, политику, проведение и действия. `additionalMovements` возвращает движения
 * документа сверх общих.
 *
 * Форму документ задаёт сам вызовом `.form(...)` на результате: её состав зависит от собственных
 * полей. На форме должна быть группа «Рассрочка» с полем `person`: после него стоят элементы
 * формы рассрочки.
 *
 * Взносы на форме недоступны для изменения, а дата закрытия скрыта: взнос добавляет действие
 * «Внести», закрывает рассрочку действие «Закрыть». Оба действия записывают рассрочку вложенным
 * `save`, а оно проверяется по правам того же пользователя, поэтому пользователю нужны права
 * и на действие, и на запись рассрочки. Непроведённую рассрочку оба действия отклоняют: её запись
 * движений не меняет, взнос не попал бы в регистры, а предел взносов не проверился бы.
 *
 * Тип результата несёт поля документа и имена действий: по ним строятся права `Rights`
 * и ссылки `Objects`.
 */
export function installmentDocument<const Name extends InstallmentName, Fields extends HeadFields & AmountField, Parts extends TablePartMap>(
    name: Name,
    title: string,
    extend: (base: HeadBuilder<Name>) => DocumentBuilder<Name, Fields, Parts>,
    additionalMovements: (record: ObjectRecord<'document', Fields, Parts>) => ReadonlyArray<RegisterMovements> = () => [],
): DocumentBuilder<Name, Fields & TailBuilder['~fields'], Parts & TailBuilder['~tableParts'], 'pay' | 'close'> {
    // Общая часть читает только общие поля, поэтому дальше документ виден как билдер с ними одними.
    // Приведение нужно, потому что для обобщённых `Fields` компилятор не проверяет имена новых полей.
    const base = tail(extend(head(name, title)) as unknown as DocumentBuilder<Name, HeadFields & AmountField, {}>);
    const target: ObjectTarget = { kind: 'document', name };

    /** Читает рассрочку вложенным действием: так чтение проверяется по правам пользователя. */
    const read = (guid: string) => Effect.gen(function* () {
        const dispatcher = yield* ActionDispatcher;
        return (yield* dispatcher.execute({ target, action: 'get', payload: { guid } })) as InstallmentRecord;
    });

    /**
     * Записывает рассрочку с изменёнными полями вложенным действием: оно проходит политику и попадает
     * в журнал. Запись проведённой рассрочки проводит её заново, поэтому движения регистров
     * обновляются без отдельного проведения.
     */
    const write = (record: InstallmentRecord, changes: Partial<InstallmentRecord>) => Effect.gen(function* () {
        const dispatcher = yield* ActionDispatcher;
        return yield* dispatcher.execute({ target, action: 'save', payload: { guid: record.guid, fields: { ...record, ...changes } } });
    });

    const complete = base
        .policy(installmentRules(name))
        .policy(closedPeriodPolicy(installmentDates, changedInstallmentDates))
        .posting((record) => Effect.gen(function* () {
            // Политика не пропускает проведение без физического лица; проверка сужает тип поля.
            if (record.person === null) return yield* rejected('Укажите физическое лицо рассрочки');
            const person = record.person;
            const basis = objectReference(target, record.guid);
            return [
                movements(InstallmentDebts, [
                    { basis, person, shift: record.shift, amount: record.amount },
                    // Взнос уменьшает долг датой взноса, но сменой рассрочки: рассрочка считается продажей
                    // выдавшей её смены, оплата которой растянута во времени.
                    ...record.payments.map((payment) => ({ basis, person, shift: record.shift, period: payment.date, amount: 0 - payment.amount })),
                ]),
                // Деньги взноса приняла смена взноса. У взноса без смены это смена рассрочки:
                // движение без смены регистр не принимает.
                movements(MoneyReceipts, record.payments.map((payment) => ({ shift: payment.shift ?? record.shift, method: payment.method, period: payment.date, amount: payment.amount }))),
                // Запись документа содержит и его собственные поля: общий тип их только не называет.
                ...additionalMovements(record as unknown as ObjectRecord<'document', Fields, Parts>),
            ];
        }))
        .action('pay', (action) => action
            .title('Внести')
            .input((input) => input
                .field('installment', (field) => field.reference(base).title('Рассрочка').required())
                .field('date', (field) => field.dateTime().title('Дата').required())
                .field('method', (field) => field.string().title('Способ').choices(paymentMethods).required())
                .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
                .field('receiver', receiverField))
            .handle((input) => Effect.gen(function* () {
                const record = yield* read(input.installment);
                if (record.closedAt !== null) return yield* rejected('Рассрочка закрыта, взносов она не принимает');
                if (!record.posted) return yield* rejected(`${notPosted}, чтобы внести взнос`);
                // Взнос запоминает смену, в которую его приняли. Без открытой смены взнос принимается
                // с пустой сменой: работа не должна зависеть от того, успели ли открыть смену.
                const database = yield* Database;
                const shift = yield* database.get(query(Shift).select({
                    columns: ['guid'],
                    where: [{ column: 'closedAt', operator: '=', value: null }],
                    limit: 1,
                }));
                // Необязательное поле, не переданное в запросе, приходит в действие как `undefined`, а запись принимает `null`.
                const payment = { date: input.date, method: input.method, amount: input.amount, receiver: input.receiver ?? null, shift: shift?.guid ?? null };
                return yield* write(record, { payments: [...record.payments, payment] });
            })))
        .action('close', (action) => action
            .title('Закрыть')
            .input((input) => input
                .field('installment', (field) => field.reference(base).title('Рассрочка').required())
                .field('closedAt', (field) => field.dateTime().title('Дата закрытия').required()))
            .handle((input) => Effect.gen(function* () {
                const record = yield* read(input.installment);
                if (record.closedAt !== null) return yield* rejected('Рассрочка уже закрыта');
                if (!record.posted) return yield* rejected(`${notPosted}, чтобы закрыть её`);
                // Условие закрытия и допустимость даты проверяет политика: она же отклонит запись формы с датой закрытия.
                return yield* write(record, { closedAt: input.closedAt });
            })));
    // Точный тип существует только на уровне типов: билдер хранит поля документа в состоянии,
    // а общая часть добавлена к тем же полям.
    return complete as unknown as DocumentBuilder<Name, Fields & TailBuilder['~fields'], Parts & TailBuilder['~tableParts'], 'pay' | 'close'>;
}
