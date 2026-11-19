/**
 * Создание начальных пользователей из настроек или параметров `--test-pin`.
 */
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { storeRecord } from '../data/records.js';
import { Database } from '../database/database.effect.js';
import { insert, query } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
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
    catalog: ObjectDescription,
    users: ReadonlyArray<InitialUser>,
    knownRoles: ReadonlyArray<string>,
    pinHash: (pin: string) => string,
) {
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
            const row = yield* database.get(query(catalog).count({}));
            if ((row?.total ?? 0) !== 0) return;
            for (const user of users) {
                const guid = randomUUID();
                const roles = [...new Set(user.roles ?? knownRoles)].sort().map(role => ({ role }));
                // Общая запись справочника используется и до появления пользователя, от имени которого можно вызвать API.
                yield* storeRecord(catalog, { guid, name: user.name.trim(), disabledAt: null, deletedAt: null }, { roles }, true);
                yield* database.run(insert('platform_user_credentials', { userGuid: guid, pinHash: pinHash(user.pin) }));
            }
        }));
    });
}
