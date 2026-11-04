import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import { select } from '../database/sql.builder.js';
import type { UserAccount } from './descriptions.js';

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
