/** Адаптер сохраняет исходные таблицы авторизации; переноса UUID, PIN и сессий нет. */
import { randomBytes } from 'node:crypto';
import { Effect } from 'effect';
import type { RoleDescription } from '../authorization/roles.js';
import { assignUserRoles, userRoleNames } from '../authorization/user-roles.js';
import { DataNotFoundError, DataPolicyError, DataValidationError } from '../data/data.errors.js';
import { guidValue } from '../data/records.js';
import type { ObjectStorage } from '../data/object-storage.js';
import { Database, ReadonlyDatabase } from '../database/database.effect.js';
import { insert, select, update } from '../database/sql.builder.js';

/** Замыкание даёт адаптеру хеширование, не добавляя секрет настроек к метаданным полей. */
export function userStorage(pinHash: (pin: string) => string, roles: readonly RoleDescription[]): ObjectStorage {
    const load = (guid: string) => Effect.gen(function* () {
        const database = yield* Database;
        const row = yield* database.get<{ guid: string; name: string; disabledAt: string | null }>(select('platform_users', {
            columns: ['guid', 'name', 'disabledAt'], where: [{ column: 'guid', operator: '=', value: guid }],
        }));
        if (row === undefined) return yield* new DataNotFoundError({ message: 'Пользователь не найден' });
        return { ...row, deletedAt: null, roles: [...yield* userRoleNames(guid)].sort().map(role => ({ role })) };
    });
    const revokeAll = (guid: string) => Effect.gen(function* () {
        const database = yield* Database;
        const revokedAt = new Date().toISOString();
        const where = [{ column: 'userGuid', operator: '=' as const, value: guid }, { column: 'revokedAt', operator: '=' as const, value: null }];
        yield* database.run(update('platform_sessions', { revokedAt }, where));
        yield* database.run(update('platform_tokens', { revokedAt }, where));
    });
    return {
        schema: [
            // Проекция исключает секретные колонки и добавляет стандартную пометку справочника.
            { sql: 'CREATE VIEW IF NOT EXISTS catalog_users AS SELECT guid, NULL AS deletedAt, name, disabledAt FROM platform_users', parameters: [] },
            { sql: 'CREATE VIEW IF NOT EXISTS catalog_users_roles AS SELECT userGuid AS ownerGuid, ROW_NUMBER() OVER (PARTITION BY userGuid ORDER BY role) AS lineNumber, role FROM platform_user_roles', parameters: [] },
        ],
        standardActions: ['list', 'get', 'save'],
        save: (guid, input, creating) => Effect.gen(function* () {
            const database = yield* Database;
            const existing = creating ? undefined : yield* load(guid);
            const assignments = (input['roles'] as { role: string }[]).map(row => row.role);
            const previous = (existing?.['roles'] ?? []) as { role: string }[];
            // Удалённую из конфигурации роль можно сохранить или снять, но нельзя назначить заново.
            if (assignments.some(name => !roles.some(role => role.name === name) && !previous.some(row => row.role === name))) {
                return yield* new DataValidationError({ message: 'Выбрана роль, которой нет в конфигурации', fields: ['roles'] });
            }
            const name = String(input['name']).trim();
            if (name === '') return yield* new DataValidationError({ message: 'Укажите имя пользователя', fields: ['name'] });
            const values = { name, disabledAt: input['disabledAt'] as string | null ?? null };
            // До установки PIN новая учётная запись не имеет действующего секрета входа.
            if (creating) yield* database.run(insert('platform_users', { guid, ...values, pinHash: randomBytes(32).toString('hex') }));
            else yield* database.run(update('platform_users', values, [{ column: 'guid', operator: '=', value: guid }]));
            const names = [...new Set(assignments)].sort();
            if (JSON.stringify(previous.map(row => row.role).sort()) !== JSON.stringify(names)) yield* assignUserRoles(guid, names);
            if (values.disabledAt !== null && existing?.['disabledAt'] == null) yield* revokeAll(guid);
            return yield* load(guid);
        }),
        callFunction: (name, input) => {
            if (!['sessions', 'roleOptions'].includes(name)) return undefined;
            return Effect.gen(function* () {
                if (name === 'roleOptions') return roles.map(({ name, title, all }) => ({ name, title, all }));
                const guid = guidValue(input['guid'], 'guid');
                const database = yield* ReadonlyDatabase;
                const account = yield* database.get(select('platform_users', { columns: ['guid'], where: [{ column: 'guid', operator: '=', value: guid }] }));
                if (account === undefined) return yield* new DataNotFoundError({ message: 'Пользователь не найден' });
                return yield* database.all(select('platform_sessions', {
                    columns: ['guid', 'createdAt', 'lastConnectedAt', 'refreshedAt'],
                    where: [{ column: 'userGuid', operator: '=', value: guid }, { column: 'revokedAt', operator: '=', value: null }, { column: 'expiresAt', operator: '>', value: new Date().toISOString() }],
                    orderBy: [{ column: 'createdAt', direction: 'DESC' }],
                }));
            });
        },
        journalChanges: (action, input) => action === 'setPin' ? { pinChanged: { before: null, after: true } }
            : action === 'revokeSession' ? { sessionGuid: { before: null, after: input['sessionGuid'] } } : null,
        action: (action, input) => {
            if (!['setPin', 'revokeSession'].includes(action)) return undefined;
            return Effect.gen(function* () {
                const guid = guidValue(input['guid'], 'guid');
                yield* load(guid);
                const database = yield* Database;
                if (action === 'setPin') {
                    const pin = input['pin'];
                    if (typeof pin !== 'string' || !/^[0-9]{4,12}$/.test(pin)) return yield* new DataValidationError({ message: 'PIN должен содержать от 4 до 12 цифр', fields: ['pin'] });
                    const hash = pinHash(pin);
                    const duplicate = yield* database.get(select('platform_users', { columns: ['guid'], where: [{ column: 'pinHash', operator: '=', value: hash }] }));
                    if (duplicate !== undefined && duplicate['guid'] !== guid) return yield* new DataPolicyError({ message: 'Этот PIN уже используется другим пользователем' });
                    yield* database.run(update('platform_users', { pinHash: hash }, [{ column: 'guid', operator: '=', value: guid }]));
                    yield* revokeAll(guid);
                    return null;
                }
                const sessionGuid = guidValue(input['sessionGuid'], 'sessionGuid');
                const session = yield* database.get(select('platform_sessions', { columns: ['guid'], where: [{ column: 'guid', operator: '=', value: sessionGuid }, { column: 'userGuid', operator: '=', value: guid }] }));
                if (session === undefined) return yield* new DataNotFoundError({ message: 'Сессия не найдена' });
                const revokedAt = new Date().toISOString();
                yield* database.run(update('platform_sessions', { revokedAt }, [{ column: 'guid', operator: '=', value: sessionGuid }]));
                yield* database.run(update('platform_tokens', { revokedAt }, [{ column: 'sessionGuid', operator: '=', value: sessionGuid }, { column: 'revokedAt', operator: '=', value: null }]));
                return null;
            });
        },
    };
}
