import { Effect } from 'effect';
import type { RoleDescription } from '../authorization/roles.js';
import { DataNotFoundError, DataPolicyError, DataValidationError } from '../data/data.errors.js';
import type { PlatformObjectBehavior } from '../data/platform-object-behavior.js';
import { guidValue, type RecordValue } from '../data/records.js';
import { Database } from '../database/database.effect.js';
import { select, update } from '../database/sql.builder.js';
import type { UserAdministration, UserSession } from './descriptions.js';

/** Проверяет, что действие относится к действительной записи справочника. */
const requireUser = Effect.fnUntraced(function* (database: Database, guid: string) {
    const user = yield* database.get(select('catalog_users', { columns: ['guid'], where: [{ column: 'guid', operator: '=', value: guid }] }));
    if (user === undefined) return yield* new DataNotFoundError({ message: 'Пользователь не найден' });
});

/** Отзыв в транзакции записи пользователя закрывает одновременно сессии и выпущенные токены. */
const revokeAllSessions = Effect.fnUntraced(function* (database: Database, guid: string) {
    const revokedAt = new Date().toISOString();
    const where = [{ column: 'userGuid', operator: '=' as const, value: guid }, { column: 'revokedAt', operator: '=' as const, value: null }];
    yield* database.run(update('platform_sessions', { revokedAt }, where));
    yield* database.run(update('platform_tokens', { revokedAt }, where));
});

/** Подключает только служебные операции пользователей. Общие обработчики конфигурации не получают право записи в БД. */
export function userAdministration(database: Database, roles: readonly RoleDescription[], pinHash: (pin: string) => string): UserAdministration {
    return {
        /** Публикует названия ролей, включая актуальный признак полного доступа. */
        roleOptions: Effect.succeed(roles.map(({ name, title, all }) => ({ name, title, all }))),
        /** Возвращает только публичные сведения о действующих сессиях пользователя. */
        sessions: Effect.fnUntraced(function* (input: { readonly guid: string }) {
            const guid = guidValue(input.guid, 'guid');
            yield* requireUser(database, guid);
            return yield* database.all<UserSession & RecordValue>(select('platform_sessions', {
                columns: ['guid', 'createdAt', 'lastConnectedAt', 'refreshedAt'],
                where: [
                    { column: 'userGuid', operator: '=', value: guid },
                    { column: 'revokedAt', operator: '=', value: null },
                    { column: 'expiresAt', operator: '>', value: new Date().toISOString() },
                ],
                orderBy: [{ column: 'createdAt', direction: 'DESC' }],
            }));
        }),
        /** Сохраняет HMAC, сохраняя запрет повторного PIN и отзывая все прежние сессии. */
        setPin: Effect.fnUntraced(function* (input: { readonly guid: string; readonly pin: string }) {
            const guid = guidValue(input.guid, 'guid');
            yield* requireUser(database, guid);
            if (!/^[0-9]{4,12}$/.test(input.pin)) return yield* new DataValidationError({ message: 'PIN должен содержать от 4 до 12 цифр', fields: ['pin'] });
            const hash = pinHash(input.pin);
            const duplicate = yield* database.get<{ userGuid: string }>(select('platform_user_credentials', {
                columns: ['userGuid'], where: [{ column: 'pinHash', operator: '=', value: hash }],
            }));
            if (duplicate !== undefined && duplicate.userGuid !== guid) return yield* new DataPolicyError({ message: 'Этот PIN уже используется другим пользователем' });
            yield* database.run({
                sql: 'INSERT INTO platform_user_credentials (userGuid, pinHash) VALUES (?, ?) ON CONFLICT(userGuid) DO UPDATE SET pinHash = excluded.pinHash',
                parameters: [guid, hash],
            });
            yield* revokeAllSessions(database, guid);
            return null;
        }),
        /** Отзывает выбранную сессию и проверяет её принадлежность записи из формы. */
        revokeSession: Effect.fnUntraced(function* (input: { readonly guid: string; readonly sessionGuid: string }) {
            const guid = guidValue(input.guid, 'guid');
            yield* requireUser(database, guid);
            const sessionGuid = guidValue(input.sessionGuid, 'sessionGuid');
            const revokedAt = new Date().toISOString();
            const result = yield* database.run(update('platform_sessions', { revokedAt }, [
                { column: 'guid', operator: '=', value: sessionGuid },
                { column: 'userGuid', operator: '=', value: guid },
            ]));
            if (result.changes === 0) return yield* new DataNotFoundError({ message: 'Сессия не найдена' });
            yield* database.run(update('platform_tokens', { revokedAt }, [
                { column: 'sessionGuid', operator: '=', value: sessionGuid },
                { column: 'revokedAt', operator: '=', value: null },
            ]));
            return null;
        }),
    };
}

/** Подключает правила учётной записи к штатной записи справочника и безопасному журналированию. */
export function userRecordBehavior(roles: readonly RoleDescription[]): PlatformObjectBehavior {
    const knownRoles = new Set(roles.map(role => role.name));
    return {
        unavailableActions: ['markDeleted', 'unmarkDeleted', 'import', 'lookup'],
        /** Приводит имя и роли к тому же виду, в котором их возвращал справочник до переноса. */
        prepareSave: Effect.fnUntraced(function* (input, previous) {
            const name = (input['name'] as string).trim();
            if (name === '') return yield* new DataValidationError({ message: 'Укажите имя пользователя', fields: ['name'] });
            const assignments = new Set((input['roles'] as { role: string }[]).map(row => row.role));
            const previousRoles = new Set(((previous?.['roles'] ?? []) as { role: string }[]).map(row => row.role));
            // Удалённую из конфигурации роль можно сохранить или снять, но нельзя назначить заново.
            if ([...assignments].some(role => !knownRoles.has(role) && !previousRoles.has(role))) {
                return yield* new DataValidationError({ message: 'Выбрана роль, которой нет в конфигурации', fields: ['roles'] });
            }
            return { ...input, name, roles: [...assignments].sort().map(role => ({ role })) };
        }),
        /** Отзывает сеансы при переходе в отключённое состояние. Повторное включение их не восстанавливает. */
        afterSave: Effect.fnUntraced(function* (record, previous) {
            if (record['disabledAt'] != null && previous?.['disabledAt'] == null) {
                yield* revokeAllSessions(yield* Database, record['guid'] as string);
            }
        }),
        /** Сохраняет факт смены PIN и UUID отозванной сессии без секретов входа. */
        actionJournal: (action, input) => ({
            guid: input['guid'] as string,
            changes: action === 'setPin' ? { pinChanged: { before: null, after: true } }
                : action === 'revokeSession' ? { sessionGuid: { before: null, after: input['sessionGuid'] } } : null,
        }),
    };
}
