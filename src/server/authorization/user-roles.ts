/**
 * Роли из табличной части справочника пользователей `catalog_users_roles`.
 *
 * Строка таблицы — пара «пользователь, имя роли». Хранится имя, а не состав прав: права роли
 * задаёт конфигурация. Чтение внутри транзакции действия видит сохранённые в ней назначения.
 */
import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { select } from '../database/sql.builder.js';

/** Имена ролей пользователя. У пользователя без ролей список пуст. */
export function userRoleNames(userGuid: string): Effect.Effect<ReadonlyArray<string>, DatabaseError, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const rows = yield* database.all<{ role: string }>(select('catalog_users_roles', {
            columns: ['role'], where: [{ column: 'ownerGuid', operator: '=', value: userGuid }],
            orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
        }));
        return rows.map((row) => row.role);
    });
}
