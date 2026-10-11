/**
 * Рассрочка: товар, который покупатель оплачивает взносами. Ведётся отдельно от продаж: продажей
 * не становится и возвратом не уменьшается. У рассрочки два состояния, открыта и закрыта;
 * закрытая не изменяется и взносов не принимает.
 *
 * Сумма и остаток хранятся вычисляемыми полями шапки: по остатку работают блок незакрытых
 * рассрочек и условие закрытия. Проведённая рассрочка записывает в регистр «Расчёты
 * с покупателями» свою сумму и взносы; по итогу регистра проверяется предел взносов.
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { Database } from '../../server/database/database.effect.js';
import { document, formula, movements, objectReference, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { Goods } from '../goods.js';
import { rubles } from '../money.js';
import { CustomerSettlements } from '../registers/customer-settlements.register.js';
import { Shift } from './shift.document.js';

/**
 * Описание без политики и действий. Действия принимают ссылку на саму рассрочку, а ссылка
 * на `Installment` из его же объявления не дала бы вывести тип.
 */
const installment = document('installment')
    .title('Рассрочка')
    .field('type', (field) => field.string().title('Тип').choices(['Банковская', 'Собственная']).required())
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    .field('person', (field) => field.reference(PhysicalPersons).title('Физическое лицо').required())
    .field('amount', (field) => field.money().title('Сумма').required().computed(formula.sum('goods', 'total')))
    .field('balance', (field) => field.money().title('Остаток').required().computed(formula.subtract(formula.field('amount'), formula.sum('payments', 'amount'))))
    .field('closedAt', (field) => field.dateTime().title('Закрыта'))
    .tablePart('goods', (part) => part.title('Товары').include(Goods))
    .tablePart('payments', (part) => part
        .title('Взносы')
        .field('date', (field) => field.dateTime().title('Дата').required())
        .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
        .field('recipient', (field) => field.string().title('Получатель').maximumLength(200))
        // Смена, в которую взнос приняли; на движение не влияет: оно относится к смене рассрочки.
        // Необязательна: взнос принимается и без открытой смены.
        .field('shift', (field) => field.reference(Shift).title('Смена')))
    .listTableParts(['goods']);

type InstallmentRecord = RecordOf<typeof installment>;

const rejected = (message: string) => new DataPolicyError({ message });

const closedRejection = 'Рассрочка закрыта, изменить её нельзя';

const notPosted = 'Рассрочка не проведена: сначала проведите её';

/**
 * Правила рассрочки (раздел «Правила учёта»).
 *
 * Запись с датой закрытия политика не отличает от закрытия действием «Закрыть»: так рассрочку
 * закрывает само действие. Поэтому условие закрытия проверяется здесь. Предел взносов политика
 * не проверяет: его задаёт ограничение регистра «Расчёты с покупателями».
 */
const installmentRules: Policy<InstallmentRecord> = {
    name: 'installment-rules',
    save: ({ existingRecord, proposedRecord }) => {
        if (existingRecord !== null && existingRecord.closedAt !== null) return Effect.fail(rejected(closedRejection));
        // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
        if ((proposedRecord.closedAt ?? null) !== null && proposedRecord.balance !== 0) {
            return Effect.fail(rejected(`Рассрочку можно закрыть, только когда остаток равен нулю, а он равен ${rubles(proposedRecord.balance)}`));
        }
        return Effect.void;
    },
    markDeleted: ({ record }) => record.closedAt === null ? Effect.void : Effect.fail(rejected(closedRejection)),
};

const target: ObjectTarget = { kind: 'document', name: 'installment' };

/** Читает рассрочку вложенным действием: так чтение проверяется по правам пользователя. */
const read = (guid: string) => Effect.gen(function* () {
    const dispatcher = yield* ActionDispatcher;
    return (yield* dispatcher.execute({ target, action: 'get', payload: { guid } })) as InstallmentRecord;
});

/**
 * Записывает рассрочку с изменёнными полями вложенным действием: оно проходит политику и попадает
 * в журнал. Запись проведённой рассрочки проводит её заново, поэтому движения регистра обновляются
 * без отдельного проведения.
 */
const write = (record: InstallmentRecord, changes: Partial<InstallmentRecord>) => Effect.gen(function* () {
    const dispatcher = yield* ActionDispatcher;
    return yield* dispatcher.execute({ target, action: 'save', payload: { guid: record.guid, fields: { ...record, ...changes } } });
});

/**
 * Взносы на форме недоступны для изменения, а дата закрытия скрыта: взнос добавляет действие
 * «Внести», закрывает рассрочку действие «Закрыть». Состояние показывает элемент
 * `InstallmentState`; он же выводит кнопки обоих действий и передаёт им `guid` рассрочки.
 * Стандартные кнопки этих действий элемент скрывает: их окно потребовало бы выбрать рассрочку.
 *
 * Действия записывают рассрочку вложенным `save`, а оно проверяется по правам того же
 * пользователя, поэтому пользователю нужны права и на действие, и на запись рассрочки.
 *
 * Оба действия отклоняют непроведённую рассрочку: её запись движений не меняет, и взнос не попал
 * бы в регистр, а предел взносов не проверился бы.
 */
export const Installment = installment
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Рассрочка', ['number', 'date', 'type', 'shift', 'person'])
        .group('Товары', ['goods', 'amount'])
        .group('Взносы', ['payments', 'balance'])
        .hide('closedAt')
        .hide('posted'))
    .policy(installmentRules)
    .posting((record) => {
        const basis = objectReference(target, record.guid);
        return Effect.succeed([
            movements(CustomerSettlements, [
                { basis, person: record.person, shift: record.shift, amount: record.amount },
                // Взнос уменьшает долг датой взноса, но сменой рассрочки: рассрочка считается продажей
                // выдавшей её смены, оплата которой растянута во времени.
                ...record.payments.map((payment) => ({ basis, person: record.person, shift: record.shift, period: payment.date, amount: 0 - payment.amount })),
            ]),
        ]);
    })
    .action('pay', (action) => action
        .title('Внести')
        .input((input) => input
            .field('installment', (field) => field.reference(installment).title('Рассрочка').required())
            .field('date', (field) => field.dateTime().title('Дата').required())
            .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
            .field('recipient', (field) => field.string().title('Получатель').maximumLength(200)))
        .handle((input) => Effect.gen(function* () {
            const record = yield* read(input.installment);
            if (record.closedAt !== null) return yield* rejected('Рассрочка закрыта, взносов она не принимает');
            if (!record.posted) return yield* rejected(`${notPosted}, чтобы внести взнос`);
            // Взнос запоминает смену, в которую его приняли; в учёте он относится к смене рассрочки.
            // Без открытой смены взнос принимается с пустой сменой: работа не должна зависеть от того,
            // успели ли открыть смену.
            const database = yield* Database;
            const shift = yield* database.get(query(Shift).select({
                columns: ['guid'],
                where: [{ column: 'closedAt', operator: '=', value: null }],
                limit: 1,
            }));
            // Необязательное поле, не переданное в запросе, приходит в действие как `undefined`, а запись принимает `null`.
            const payment = { date: input.date, amount: input.amount, recipient: input.recipient ?? null, shift: shift?.guid ?? null };
            return yield* write(record, { payments: [...record.payments, payment] });
        })))
    .action('close', (action) => action
        .title('Закрыть')
        .input((input) => input.field('installment', (field) => field.reference(installment).title('Рассрочка').required()))
        .handle((input) => Effect.gen(function* () {
            const record = yield* read(input.installment);
            if (record.closedAt !== null) return yield* rejected('Рассрочка уже закрыта');
            if (!record.posted) return yield* rejected(`${notPosted}, чтобы закрыть её`);
            // Условие закрытия проверяет политика: она же отклонит запись формы с датой закрытия.
            return yield* write(record, { closedAt: new Date().toISOString() });
        })));
