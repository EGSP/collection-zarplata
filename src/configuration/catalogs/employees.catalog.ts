/**
 * Сотрудники: запись ссылается на физическое лицо и показывается его ФИО. ФИО в сотруднике
 * не хранится: копия разошлась бы с физическим лицом после его изменения.
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { selectTyped } from '../../server/data/typed-select.js';
import { Database } from '../../server/database/database.effect.js';
import { catalog, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { PhysicalPersons } from './physical-persons.catalog.js';

/**
 * Описание без политики. Политика читает таблицу самого справочника, а ссылка на `Employees`
 * из его же объявления не дала бы вывести тип.
 */
const employees = catalog('employees')
    .title('Сотрудники')
    .field('person', (field) => field.reference(PhysicalPersons).title('Физическое лицо').required())
    .presentation('person');

/**
 * Не даёт завести двух сотрудников на одно физическое лицо. Сотрудник с пометкой удаления тоже
 * занимает физическое лицо: после снятия пометки в справочнике оказались бы два сотрудника
 * одного человека.
 */
const onePersonOneEmployee: Policy<RecordOf<typeof employees>> = {
    name: 'one-person-one-employee',
    save: ({ proposedRecord }) => Effect.gen(function* () {
        const database = yield* Database;
        const occupying = yield* database.get(selectTyped(employees, {
            columns: ['name', 'deletedAt'],
            where: [
                { column: 'person', operator: '=', value: proposedRecord.person },
                // Без исключения самой записи повторная запись того же сотрудника была бы отклонена.
                { column: 'guid', operator: '!=', value: proposedRecord.guid },
            ],
            limit: 1,
        }));
        if (occupying === undefined) return;
        const deletionNote = occupying.deletedAt === null ? '' : ', помеченный на удаление';
        return yield* new DataPolicyError({
            message: `На это физическое лицо уже заведён сотрудник с кодом «${occupying.name}»${deletionNote}`,
        });
    }),
};

/**
 * Стандартное наименование служит коротким обозначением сотрудника и подписано «Код». Полей
 * на форме немного, поэтому новая запись создаётся в окне поверх списка, а не в отдельной вкладке.
 */
export const Employees = employees
    .form((form) => form
        .title('name', 'Код')
        .creation('dialog'))
    .policy(onePersonOneEmployee);
