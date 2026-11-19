import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import { select } from '../database/sql.builder.js';
import type { UserAccount } from './descriptions.js';

/** Читает публичные поля справочника и назначения для редактора и дерева прав. */
export const readUserAccounts = Effect.fn('users.read')(function* () {
    const database = yield* Database;
    const users = yield* database.all<Omit<UserAccount, 'roles'>>(select('catalog_users', {
        columns: ['guid', 'name', 'disabledAt'], orderBy: [{ column: 'name', direction: 'ASC' }],
    }));
    const assignments = yield* database.all<{ ownerGuid: string; role: string }>(select('catalog_users_roles', {
        columns: ['ownerGuid', 'role'], orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const roles = new Map<string, string[]>();
    for (const assignment of assignments) {
        const names = roles.get(assignment.ownerGuid) ?? [];
        names.push(assignment.role);
        roles.set(assignment.ownerGuid, names);
    }
    return users.map((user): UserAccount => ({ ...user, roles: roles.get(user.guid) ?? [] }));
});
