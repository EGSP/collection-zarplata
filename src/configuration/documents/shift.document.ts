/**
 * Смена: её открывают с составом сотрудников, изменяют, пока она открыта, и закрывают без
 * возможности переоткрыть. Датой открытия служит стандартная дата документа, дату закрытия
 * записывает действие закрытия, и оно же проводит смену. У смены только два состояния, открыта
 * и закрыта, поэтому отмена проведения и пометка удаления запрещены: ошибочно открытую смену закрывают.
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { selectTyped } from '../../server/data/typed-select.js';
import { Database } from '../../server/database/database.effect.js';
import { document, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { Employees } from '../catalogs/employees.catalog.js';
import { ShiftEmployees } from '../form-elements/shift-employees.form-element.js';
import { ShiftState } from '../form-elements/shift-state.form-element.js';

/**
 * Описание без политики и действия закрытия. Они читают таблицу самого документа, а ссылка
 * на `Shift` из его же объявления не дала бы вывести тип.
 */
const shift = document('shift')
    .title('Смена')
    .field('closedAt', (field) => field.dateTime().title('Закрыта'))
    .tablePart('employees', (part) => part
        .title('Состав')
        .field('employee', (field) => field.reference(Employees).title('Сотрудник').required()));

type ShiftRecord = RecordOf<typeof shift>;

const rejected = (message: string) => new DataPolicyError({ message });

/**
 * Момент времени значения даты со временем. Значения хранятся строками ISO 8601 с тем часовым
 * поясом, с которым их передал клиент, поэтому сравнение строк дало бы неверный порядок.
 */
const moment = (value: string): number => new Date(value).getTime();

/** Дата и время в тексте отказа, по часовому поясу сервера, как в списках. */
const formatted = (value: string): string => new Date(value).toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
}).replace(',', '');

/**
 * Правила смены.
 *
 * Открытая смена при проверке пересечений не считается длящейся бесконечно: иначе смену задним
 * числом нельзя было бы открыть раньше уже существующих смен. Поэтому вторую открытую смену
 * запрещает отдельное правило, а полный интервал проверяется при закрытии. Смены с общей границей
 * не пересекаются: следующую смену можно открыть в момент закрытия предыдущей.
 *
 * Запись с заполненной датой закрытия политика не отличает от закрытия действием: так закрывает
 * смену само действие. Смена, закрытая записью через единый эндпоинт, остаётся непроведённой
 * и исправляется проведением.
 */
const shiftRules: Policy<ShiftRecord> = {
    name: 'shift-rules',
    save: ({ existingRecord, proposedRecord }) => Effect.gen(function* () {
        if (existingRecord !== null && existingRecord.closedAt !== null) {
            return yield* rejected('Смена закрыта, изменить её нельзя');
        }
        if (proposedRecord.employees.length === 0) {
            return yield* rejected('В составе смены нет сотрудников');
        }
        const employees = proposedRecord.employees.map((line) => line.employee);
        if (new Set(employees).size !== employees.length) {
            return yield* rejected('Сотрудник указан в составе смены больше одного раза');
        }
        const openedAt = moment(proposedRecord.date);
        const closedAt = proposedRecord.closedAt === null ? null : moment(proposedRecord.closedAt);
        if (closedAt !== null && closedAt <= openedAt) {
            return yield* rejected('Дата закрытия смены должна быть позже даты открытия');
        }
        const database = yield* Database;
        const others = yield* database.all(selectTyped(shift, {
            columns: ['number', 'date', 'closedAt'],
            // Без исключения самой записи открытая смена мешала бы собственному изменению и закрытию.
            where: [{ column: 'guid', operator: '!=', value: proposedRecord.guid }],
        }));
        for (const other of others) {
            if (other.closedAt === null) {
                if (existingRecord === null) {
                    return yield* rejected(`Смена № ${other.number} от ${formatted(other.date)} ещё открыта: сначала закройте её`);
                }
                continue;
            }
            const otherOpenedAt = moment(other.date);
            const otherClosedAt = moment(other.closedAt);
            const interval = `смены № ${other.number} с ${formatted(other.date)} по ${formatted(other.closedAt)}`;
            if (otherOpenedAt <= openedAt && openedAt < otherClosedAt) {
                return yield* rejected(`Дата открытия попадает внутрь ${interval}`);
            }
            if (closedAt !== null && openedAt < otherClosedAt && otherOpenedAt < closedAt) {
                return yield* rejected(`Смена пересекается с интервалом ${interval}`);
            }
        }
    }),
    post: ({ document }) => document.closedAt === null
        ? Effect.fail(rejected('Смена проводится только закрытием: у неё нет даты закрытия'))
        : Effect.void,
    unpost: () => Effect.fail(rejected('Отменить проведение смены нельзя: закрытая смена не открывается заново')),
    markDeleted: () => Effect.fail(rejected('Смену нельзя пометить на удаление: ошибочно открытую смену закройте')),
};

const target = { kind: 'document', name: 'shift' };

/**
 * Дата закрытия на форме скрыта: запись формы с заполненной датой закрыла бы смену без проведения.
 * Состояние смены показывает элемент `ShiftState`, он же скрывает на форме действия, которые
 * политика отклоняет. Стандартный флажок «Проведён» скрыт: у смены он повторяет состояние «Закрыта».
 * Полей на форме немного, поэтому новая смена создаётся в окне поверх списка.
 *
 * Действие закрытия не получает идентификатор смены: открытая смена одна. Запись и проведение оно
 * выполняет вложенными действиями, а они проверяются по правам того же пользователя, поэтому
 * пользователю нужны права на закрытие, запись и проведение смены.
 */
export const Shift = shift
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе состав оказался бы над ней.
    .form((form) => form
        .group('Смена', ['number', 'date', ShiftState])
        .group('Сотрудники', [ShiftEmployees, 'employees'])
        .title('date', 'Открыта')
        .hide('closedAt')
        .hide('posted')
        .creation('dialog'))
    .policy(shiftRules)
    .action('close', (action) => action
        .title('Закрыть смену')
        .input((input) => input.field('closedAt', (field) => field.dateTime().title('Дата закрытия').required()))
        .handle((input) => Effect.gen(function* () {
            const database = yield* Database;
            const dispatcher = yield* ActionDispatcher;
            const open = yield* database.get(selectTyped(shift, {
                columns: ['guid'],
                where: [{ column: 'closedAt', operator: '=', value: null }],
                limit: 1,
            }));
            if (open === undefined) return yield* rejected('Открытой смены нет: закрывать нечего');
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: open.guid } })) as ShiftRecord;
            yield* dispatcher.execute({
                target, action: 'save',
                payload: {
                    guid: open.guid,
                    fields: {
                        date: record.date,
                        closedAt: input.closedAt,
                        employees: record.employees.map((line) => ({ employee: line.employee })),
                    },
                },
            });
            return yield* dispatcher.execute({ target, action: 'post', payload: { guid: open.guid } });
        })));
