/**
 * Создание начальных пользователей из настроек или параметров `--test-pin`.
 */
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { assignUserRoles } from '../authorization/user-roles.js';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { insert } from '../database/sql.builder.js';
import type { InitialUser } from '../settings/settings.service.js';
import { InitialDataError } from './initial-data.errors.js';

/**
 * Создаёт пользователей только в пустой таблице и назначает им роли. Пользователь без списка
 * ролей получает все роли конфигурации: первый пользователь должен иметь доступ ко всему,
 * иначе назначить права было бы некому. Роль, которой нет в конфигурации, останавливает
 * запуск: пользователь с ней остался бы без прав. Роли проверяются и на непустой таблице,
 * чтобы опечатка в настройках не ждала следующей новой базы.
 */
export function createInitialUsers(
    users: ReadonlyArray<InitialUser>,
    knownRoles: ReadonlyArray<string>,
    pinHash: (pin: string) => string,
): Effect.Effect<void, InitialDataError | DatabaseError, Database> {
    return Effect.gen(function* () {
        if (users.length === 0) return;
        for (const user of users) {
            const unknown = (user.roles ?? []).filter((role) => !knownRoles.includes(role));
            if (unknown.length > 0) {
                return yield* new InitialDataError({
                    message: `Пользователю «${user.name}» назначены роли, которых нет в конфигурации: ${unknown.join(', ')}. Описанные роли: ${knownRoles.join(', ')}`,
                });
            }
        }
        const database = yield* Database;
        yield* database.transaction(Effect.gen(function* () {
            const row = yield* database.get<{ total: number }>({ sql: 'SELECT COUNT(*) AS total FROM platform_users', parameters: [] });
            if ((row?.total ?? 0) !== 0) return;
            for (const user of users) {
                const guid = randomUUID();
                yield* database.run(insert('platform_users', {
                    guid, name: user.name.trim(), pinHash: pinHash(user.pin), disabledAt: null,
                }));
                yield* assignUserRoles(guid, user.roles ?? knownRoles);
            }
        }));
    });
}
