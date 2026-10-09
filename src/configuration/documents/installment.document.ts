/**
 * Рассрочка: товар, который покупатель оплачивает взносами. Ведётся отдельно от продаж: продажей
 * не становится и возвратом не уменьшается. У рассрочки два состояния, открыта и закрыта;
 * закрытая не изменяется и взносов не принимает.
 *
 * Сумма и остаток хранятся вычисляемыми полями шапки: по остатку работают блок незакрытых
 * рассрочек и проверки взноса и закрытия.
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { document, formula, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { InstallmentState } from '../form-elements/installment-state.form-element.js';
import { OpenShift } from '../form-elements/open-shift.form-element.js';
import { Goods } from '../goods.js';
import { rubles } from '../money.js';
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
        .field('recipient', (field) => field.string().title('Получатель').maximumLength(200)))
    .listTableParts(['goods']);

type InstallmentRecord = RecordOf<typeof installment>;

const rejected = (message: string) => new DataPolicyError({ message });

const closedRejection = 'Рассрочка закрыта, изменить её нельзя';

/**
 * Правила рассрочки (раздел «Правила учёта»).
 *
 * Запись с новым взносом политика не отличает от взноса действием «Внести»: так взнос записывает
 * само действие. Поэтому предел взноса проверяется по остатку после записи: отрицательный остаток
 * означает, что взносы превысили сумму рассрочки. Так же запись с датой закрытия не отличается
 * от закрытия действием, и условие закрытия проверяется здесь.
 */
const installmentRules: Policy<InstallmentRecord> = {
    name: 'installment-rules',
    save: ({ existingRecord, proposedRecord }) => {
        if (existingRecord !== null && existingRecord.closedAt !== null) return Effect.fail(rejected(closedRejection));
        if (proposedRecord.balance < 0) {
            return Effect.fail(rejected(`Взносы превышают сумму рассрочки на ${rubles(-proposedRecord.balance)}`));
        }
        // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
        if ((proposedRecord.closedAt ?? null) !== null && proposedRecord.balance !== 0) {
            return Effect.fail(rejected(`Рассрочку можно закрыть, только когда остаток равен нулю, а он равен ${rubles(proposedRecord.balance)}`));
        }
        return Effect.void;
    },
    markDeleted: ({ record }) => record.closedAt === null ? Effect.void : Effect.fail(rejected(closedRejection)),
};

const target = { kind: 'document', name: 'installment' };

/** Читает рассрочку вложенным действием: так чтение проверяется по правам пользователя. */
const read = (guid: string) => Effect.gen(function* () {
    const dispatcher = yield* ActionDispatcher;
    return (yield* dispatcher.execute({ target, action: 'get', payload: { guid } })) as InstallmentRecord;
});

/** Записывает рассрочку с изменёнными полями вложенным действием: оно проходит политику и попадает в журнал. */
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
 */
export const Installment = installment
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Рассрочка', ['number', 'date', 'type', 'shift', 'person', OpenShift, InstallmentState])
        .group('Товары', ['goods', 'amount'])
        .group('Взносы', ['payments', 'balance'])
        .hide('closedAt')
        .hide('posted'))
    .policy(installmentRules)
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
            if (input.amount > record.balance) {
                return yield* rejected(`Взнос ${rubles(input.amount)} больше остатка ${rubles(record.balance)}`);
            }
            const payment = { date: input.date, amount: input.amount, recipient: input.recipient };
            return yield* write(record, { payments: [...record.payments, payment] });
        })))
    .action('close', (action) => action
        .title('Закрыть')
        .input((input) => input.field('installment', (field) => field.reference(installment).title('Рассрочка').required()))
        .handle((input) => Effect.gen(function* () {
            const record = yield* read(input.installment);
            if (record.closedAt !== null) return yield* rejected('Рассрочка уже закрыта');
            // Условие закрытия проверяет политика: она же отклонит запись формы с датой закрытия.
            return yield* write(record, { closedAt: new Date().toISOString() });
        })));
