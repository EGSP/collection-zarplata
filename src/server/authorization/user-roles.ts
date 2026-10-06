/**
 * Связь пользователей с ролями в служебной таблице `platform_user_roles`.
 *
 * Строка таблицы — пара «пользователь, имя роли». Хранится имя, а не состав прав: права роли
 * задаёт конфигурация. Функции работают через сервис `Database` из окружения Effect, поэтому
 * внутри транзакции действия читают и пишут через её дескриптор.
 */
import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { insert, remove, select } from '../database/sql.builder.js';

/** Служебная таблица связи; её структуру описывает модуль схемы. */
const userRolesTable = 'platform_user_roles';

/** Имена ролей пользователя. У пользователя без ролей список пуст. */
export function userRoleNames(userGuid: string): Effect.Effect<ReadonlyArray<string>, DatabaseError, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const rows = yield* database.all<{ role: string }>(select(userRolesTable, {
            columns: ['role'], where: [{ column: 'userGuid', operator: '=', value: userGuid }],
        }));
        return rows.map((row) => row.role);
    });
}

/**
 * Заменяет роли пользователя указанным набором. Вызывающий код отвечает за то, что роли описаны
 * в конфигурации, и за транзакцию: вне её пользователь на время остался бы без ролей.
 */
export function assignUserRoles(userGuid: string, roles: ReadonlyArray<string>): Effect.Effect<void, DatabaseError, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        yield* database.run(remove(userRolesTable, [{ column: 'userGuid', operator: '=', value: userGuid }]));
        for (const role of new Set(roles)) {
            yield* database.run(insert(userRolesTable, { userGuid, role }));
        }
    });
}
