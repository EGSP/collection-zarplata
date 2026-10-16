/**
 * Подбор случайных сотрудников из загруженных физических лиц.
 */
import { Effect } from 'effect';
import { Employees } from '../../configuration/catalogs/employees.catalog.js';
import { PhysicalPersons } from '../../configuration/catalogs/physical-persons.catalog.js';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { query } from '../database/sql.builder.js';
import { InitialDataError } from './initial-data.errors.js';

/** Операция записи сотрудника в формате единого эндпоинта `POST /api/perform`. */
export interface EmployeeSaveOperation {
    readonly target: { readonly kind: 'catalog'; readonly name: 'employees' };
    readonly action: 'save';
    readonly payload: { readonly fields: { readonly name: string; readonly person: string } };
}

/**
 * Готовит операции записи `count` сотрудников на случайных физических лиц без пометки удаления.
 * Если в справочнике уже есть сотрудники, возвращает пустой список: при файловой базе каждый
 * запуск иначе добавлял бы новых. Лиц меньше `count` — ошибка, а не неполный набор:
 * следующие шаги рассчитывают ровно на столько сотрудников.
 *
 * Сами записи выполняет диспетчер действий, а не прямой SQL: так проверяются политики
 * справочника и пишется журнал, как при записи из интерфейса.
 */
export function randomEmployeeOperations(count: number): Effect.Effect<ReadonlyArray<EmployeeSaveOperation>, InitialDataError | DatabaseError, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const existing = yield* database.get(query(Employees).select({ columns: ['guid'], limit: 1 }));
        if (existing !== undefined) return [];
        const persons = yield* database.all(query(PhysicalPersons).select({
            columns: ['guid'], where: [{ column: 'deletedAt', operator: '=', value: null }],
        }));
        if (persons.length < count) {
            return yield* new InitialDataError({
                message: `Для ${count} случайных сотрудников нужно столько же физических лиц, загружено ${persons.length}`,
            });
        }
        return shuffled(persons.map((person) => person.guid)).slice(0, count).map((person, index) => ({
            target: { kind: 'catalog', name: 'employees' },
            action: 'save',
            // Код сотрудника — порядковый номер; ширина как у номеров документов, чтобы коды сортировались по порядку.
            payload: { fields: { name: String(index + 1).padStart(6, '0'), person } },
        }) as const);
    });
}

/** Перемешивание Фишера — Йетса: каждая перестановка равновероятна. */
function shuffled<Value>(values: ReadonlyArray<Value>): Value[] {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const other = Math.floor(Math.random() * (index + 1));
        [result[index], result[other]] = [result[other]!, result[index]!];
    }
    return result;
}
