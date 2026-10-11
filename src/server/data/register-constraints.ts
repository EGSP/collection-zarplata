/**
 * Проверка ограничений итога регистров после изменения движений документа.
 *
 * Ограничение проверяет платформа, а не политика записи. Политика выполняется до изменения
 * данных и новых движений не видит: ей пришлось бы повторять расчёт движений документа.
 * Проверка идёт после записи движений, потому что нарушить ограничение может и их удаление:
 * без движений продажи итог по ней станет отрицательным, если по ней проведены возвраты.
 *
 * Итог пересчитывается только по сочетаниям значений измерений, которые встречаются в прежних
 * и в новых движениях документа: остальные итоги регистра изменение не затронуло. Шаг проведения
 * читает движения документа до и после изменения и передаёт оба набора сюда.
 */
import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { select, type SqlFilter, type SqlValue } from '../database/sql.builder.js';
import type { ObjectDescription, RegisterConstraintDescription } from '../metadata/descriptions.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { formatSearchValue } from '../ui/value-format.js';
import type { ActionContext, ActionDispatcher } from './action-context.js';
import { DataPolicyError } from './data.errors.js';
import { tableName, type RecordValue } from './records.js';
import { readOnlyDatabase } from './read-only-database.js';
import { readTotals, registerResources } from './register-totals.js';
import { fieldValueFromRow } from './storage-values.js';

/** Сервисы, доступные функции текста отказа: те же, что у политики записи. */
type ConstraintRequirements = Database | Metadata | ActionContext | ActionDispatcher;

/** Хранимые значения измерений движений документа в одном регистре с ограничениями. */
export interface RegisterMovementKeys {
    readonly register: ObjectDescription;
    /** Строки содержат только измерения, названные в ограничениях регистра. */
    readonly rows: ReadonlyArray<Readonly<Record<string, SqlValue>>>;
}

/**
 * Читает измерения текущих движений документа в регистрах, у которых есть ограничения.
 * Регистры без ограничений пропускаются: их движения проверке не нужны.
 */
export function documentMovementKeys(document: ObjectDescription, guid: string): Effect.Effect<ReadonlyArray<RegisterMovementKeys>, DatabaseError, Database | Metadata> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const metadata = yield* Metadata;
        const result: RegisterMovementKeys[] = [];
        for (const register of metadata.objects) {
            if (register.kind !== 'register' || register.constraints.length === 0) continue;
            const columns = [...new Set(register.constraints.flatMap((constraint) => constraint.by))];
            // У ограничения итога по всему регистру измерений нет; номер строки нужен, чтобы узнать, есть ли движения.
            const rows = yield* database.all<Record<string, SqlValue>>(select(tableName(register), {
                columns: columns.length > 0 ? columns : ['lineNumber'],
                where: [
                    { column: 'recorderDocument', operator: '=', value: document.name },
                    { column: 'recorderGuid', operator: '=', value: guid },
                ],
            }));
            if (rows.length > 0) result.push({ register, rows });
        }
        return result;
    });
}

/** Стандартный текст отказа, если конфигурация не задала свой. */
function defaultMessage(register: ObjectDescription, constraint: RegisterConstraintDescription, total: number): string {
    const resource = register.fields.find((field) => field.name === constraint.resource);
    const format = (value: number) => (resource === undefined ? null : formatSearchValue(resource.kind, value)) ?? String(value);
    return `Регистр «${register.title}»: итог «${resource?.title ?? constraint.resource}» равен ${format(total)}, наименьшее допустимое значение ${format(constraint.minimum)}`;
}

/**
 * Проверяет ограничения по сочетаниям измерений из переданных движений. Первое нарушение
 * завершает эффект `DataPolicyError` с текстом ограничения: диспетчер откатывает транзакцию
 * и возвращает HTTP 409, как при отказе политики. Функция текста отказа читает базу в той же
 * транзакции, но изменять её не может.
 */
export function enforceConstraints(movements: ReadonlyArray<RegisterMovementKeys>): Effect.Effect<void, unknown, ConstraintRequirements> {
    return Effect.gen(function* () {
        const database = yield* Database;
        for (const register of new Set(movements.map((group) => group.register))) {
            const rows = movements.filter((group) => group.register === register).flatMap((group) => group.rows);
            for (const constraint of register.constraints) {
                // Ключ различает сочетания по хранимым значениям; у итога по всему регистру сочетание одно.
                const combinations = new Map(rows.map((row) => {
                    const values = constraint.by.map((name) => row[name] ?? null);
                    return [JSON.stringify(values), values] as const;
                }));
                for (const values of combinations.values()) {
                    const where: SqlFilter[] = constraint.by.map((column, index) => ({ column, operator: '=', value: values[index] ?? null }));
                    const [row] = yield* readTotals(register, constraint.by, where);
                    const dimensions: RecordValue = Object.fromEntries(constraint.by.map((name, index) => {
                        const field = register.fields.find((candidate) => candidate.name === name);
                        return [name, field === undefined ? values[index] : fieldValueFromRow(values[index], field.kind)];
                    }));
                    // Сочетание без движений в результате отсутствует: его итог равен нулю по всем ресурсам.
                    const totals: RecordValue = Object.fromEntries(registerResources(register).map((field) => [field.name, row?.[field.name] ?? 0]));
                    const total = totals[constraint.resource] as number;
                    if (total >= constraint.minimum) continue;
                    if (constraint.message === null) return yield* new DataPolicyError({ message: defaultMessage(register, constraint, total) });
                    // После сборки описания типы измерений и ресурсов стёрты; их проверил билдер регистра.
                    const result = constraint.message({ dimensions, totals } as never);
                    if (!Effect.isEffect(result)) return yield* Effect.die(new Error(`Текст ограничения «${constraint.name}» должен вернуть Effect`));
                    const message = yield* Effect.provideService(result as Effect.Effect<unknown, unknown, ConstraintRequirements>, Database, readOnlyDatabase(database));
                    if (typeof message !== 'string') return yield* Effect.die(new Error(`Текст ограничения «${constraint.name}» должен быть строкой`));
                    return yield* new DataPolicyError({ message });
                }
            }
        }
    });
}
