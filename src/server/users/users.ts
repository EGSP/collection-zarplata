import { Effect } from 'effect';
import { RightsGuardPlatform } from '../authorization/rights-guard.platform.js';
import { platformRights } from '../authorization/rights.js';
import { assignUserRoles } from '../authorization/user-roles.js';
import { newGuid } from '../common/guid.js';
import { DataNotFoundError, DataPolicyError, DataValidationError } from '../data/data.errors.js';
import { guidValue, objectValue } from '../data/records.js';
import { Database } from '../database/database.effect.js';
import { insert, select, update } from '../database/sql.builder.js';
import { writeJournal } from '../journal/journal.js';
import type { JournalChanges } from '../journal/descriptions.js';
import type { UserAccount, UserDirectory } from './descriptions.js';

/** Читаем только публичные колонки: расширение служебной таблицы не раскроет секреты. */
export const readUserAccounts = Effect.fn('users.read')(function* () {
    const database = yield* Database;
    const users = yield* database.all<Omit<UserAccount, 'roles'>>(select('platform_users', {
        columns: ['guid', 'name', 'disabledAt'], orderBy: [{ column: 'name', direction: 'ASC' }],
    }));
    const assignments = yield* database.all<{ userGuid: string; role: string }>(select('platform_user_roles', { columns: ['userGuid', 'role'] }));
    const roles = new Map<string, string[]>();
    for (const assignment of assignments) {
        const names = roles.get(assignment.userGuid) ?? [];
        names.push(assignment.role);
        roles.set(assignment.userGuid, names);
    }
    return users.map((user): UserAccount => ({ ...user, roles: roles.get(user.guid) ?? [] }));
});

/**
 * Служебный справочник управляет теми же записями, по которым выполняется вход.
 * Диспетчер держит транзакцию для проверки прав, записи пользователя, ролей и журнала.
 */
export const userDirectoryAction = Effect.fn('users.action')(function* (
    action: string, payload: unknown, userGuid: string | null, guard: RightsGuardPlatform, pinHash: (pin: string) => string,
) {
    if (!['list', 'get', 'save'].includes(action)) return yield* new DataNotFoundError({ message: `Действие «${action}» для пользователей не найдено` });
    yield* guard.require(userGuid, action === 'save' ? platformRights.users.write : platformRights.users.read);
    const database = yield* Database;
    if (action === 'list') {
        const rights = yield* guard.rightsOf(userGuid);
        const result: UserDirectory = {
            items: yield* readUserAccounts(),
            roles: guard.roles.map(({ name, title, all }) => ({ name, title, all })),
            canWrite: rights.allows(platformRights.users.write),
        };
        return result;
    }
    const input = objectValue(payload, 'payload');
    const guid = input['guid'] === undefined && action === 'save' ? newGuid() : guidValue(input['guid'], 'guid');
    const existing = (yield* readUserAccounts()).find((user) => user.guid === guid);
    if ((action === 'get' || input['guid'] !== undefined) && existing === undefined) {
        return yield* new DataNotFoundError({ message: 'Пользователь не найден' });
    }
    if (action === 'get') return existing;
    if (typeof input['name'] !== 'string' || input['name'].trim().length === 0) {
        return yield* new DataValidationError({ message: 'Укажите имя пользователя', fields: ['name'] });
    }
    const name = input['name'].trim();
    const pin = input['pin'];
    // Отсутствие PIN при изменении оставляет прежний; пустая строка не считается отсутствием.
    if ((existing === undefined || pin !== undefined) && (typeof pin !== 'string' || !/^[0-9]{4,12}$/.test(pin))) {
        return yield* new DataValidationError({ message: 'PIN должен содержать от 4 до 12 цифр', fields: ['pin'] });
    }
    const names = input['roles'];
    if (!Array.isArray(names) || names.some((value: unknown) => typeof value !== 'string')) {
        return yield* new DataValidationError({ message: 'Укажите список ролей', fields: ['roles'] });
    }
    const roles = [...new Set(names as string[])].sort();
    if (roles.some((role) => !guard.roles.some((known) => known.name === role))) {
        return yield* new DataValidationError({ message: 'Выбрана роль, которой нет в конфигурации', fields: ['roles'] });
    }
    if (typeof input['disabled'] !== 'boolean') {
        return yield* new DataValidationError({ message: 'Укажите, отключён ли пользователь', fields: ['disabled'] });
    }
    const disabledAt = input['disabled'] ? existing?.disabledAt ?? new Date().toISOString() : null;
    const hash = typeof pin === 'string' ? pinHash(pin) : undefined;
    if (hash !== undefined) {
        const duplicate = yield* database.get<{ guid: string }>(select('platform_users', {
            columns: ['guid'], where: [{ column: 'pinHash', operator: '=', value: hash }],
        }));
        if (duplicate !== undefined && duplicate.guid !== guid) {
            return yield* new DataPolicyError({ message: 'Этот PIN уже используется другим пользователем' });
        }
    }
    const values = { name, disabledAt, ...(hash === undefined ? {} : { pinHash: hash }) };
    if (existing === undefined) yield* database.run(insert('platform_users', { guid, ...values }));
    else yield* database.run(update('platform_users', values, [{ column: 'guid', operator: '=', value: guid }]));
    yield* assignUserRoles(guid, roles);
    // Отключение и смена PIN отзывают прежние сессии, включая refresh. Включение их не восстанавливает.
    if (disabledAt !== null || hash !== undefined) {
        yield* database.run(update('platform_tokens', { revokedAt: new Date().toISOString() }, [
            { column: 'userGuid', operator: '=', value: guid }, { column: 'revokedAt', operator: '=', value: null },
        ]));
    }
    const account: UserAccount = { guid, name, disabledAt, roles };
    const changes: JournalChanges = {};
    for (const field of ['name', 'disabledAt', 'roles'] as const) {
        const before = existing?.[field] ?? null;
        const after = account[field];
        if (JSON.stringify(before) !== JSON.stringify(after)) changes[field] = { before, after };
    }
    // У смены PIN фиксируется только факт, ни исходное значение, ни HMAC сюда не передаются.
    if (hash !== undefined) changes['pinChanged'] = { before: null, after: true };
    yield* writeJournal({ occurredAt: new Date().toISOString(), target: { kind: 'platform', name: 'users', guid }, action: 'save', changes });
    return account;
});
