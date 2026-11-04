/** Редактор узлов использует тот же расчёт, что диспетчер; код обработчиков не является входом API. */
import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import { insert, remove } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { objectValue, stringValue } from '../data/records.js';
import { DataNotFoundError, DataValidationError } from '../data/data.errors.js';
import { readUserAccounts } from '../users/users.js';
import { platformRights } from './rights.js';
import type { RightsGuardPlatform, AccessSetting } from './rights-guard.platform.js';
import type { AccessLevel } from './access-schema.js';

/** Плоская передача дерева сохраняет родительский путь и единственный выбор каждого узла. */
export const accessEditorAction = Effect.fn('authorization.editor')(function* (action: string, payload: unknown, user: string | null, guard: RightsGuardPlatform, objects: readonly ObjectDescription[]) {
    yield* guard.require(user, action === 'saveSettings' ? platformRights.authorization.write : platformRights.authorization.read);
    const database = yield* Database;
    const accounts = yield* readUserAccounts();
    const input = objectValue(payload, 'payload');
    if (action === 'saveSettings') {
        const missing = ['subjectKind', 'subject', 'kind', 'name', 'path', 'level'].filter(key => typeof input[key] !== 'string');
        if (missing.length > 0) return yield* new DataValidationError({ message: 'Укажите назначение, объект, узел и уровень доступа', fields: missing });
    }
    const subjectKind = input['subjectKind'] ?? 'role';
    const subject = typeof input['subject'] === 'string' ? input['subject'] : guard.roles[0]?.name ?? '';
    if (subjectKind !== 'role' && subjectKind !== 'user') return yield* new DataValidationError({ message: 'Неизвестный вид назначения', fields: ['subjectKind'] });
    const role = guard.roles.find(role => role.name === subject);
    const account = accounts.find(account => account.guid === subject);
    if (subjectKind === 'role' ? role === undefined : account === undefined) return yield* new DataNotFoundError({ message: 'Назначение не найдено' });
    const nodes = objects.flatMap(object => {
        const internal = new Set(object.access?.entries.filter(entry => entry.path.startsWith('internal.')).map(entry => entry.path.slice(9)) ?? []);
        const node = (path: string, title: string, call = false) => ({ kind: object.kind, name: object.name, path, title, call });
        return [node('', object.title), node('fields', 'Поля'), ...(object.access?.groups ?? []).map(group => node(`groups.${group.name}`, group.title ?? group.name)),
            ...object.fields.filter(field => !internal.has(field.name)).map(field => node(`fields.${field.name}`, field.title)),
            ...object.tableParts.filter(part => !internal.has(part.name)).flatMap(part => [node(`fields.${part.name}`, part.title), ...part.fields.filter(field => !internal.has(`${part.name}.${field.name}`)).map(field => node(`fields.${part.name}.${field.name}`, `${part.title}: ${field.title}`))]),
            node('actions', 'Действия', true), ...(object.kind === 'document' ? [node('actions.post', 'Проведение', true)] : []), ...(object.kind === 'catalog' ? [node('actions.import', 'Импорт', true)] : []), ...object.actions.map(action => node(`actions.${action.name}`, action.title, true)),
            node('functions', 'Функции', true), ...object.functions.map(declared => node(`functions.${declared.name}`, declared.title, true))];
    });
    if (action === 'saveSettings') {
        const kind = stringValue(input['kind'], 'kind'); const name = stringValue(input['name'], 'name'); const path = typeof input['path'] === 'string' ? input['path'] : '';
        const node = nodes.find(node => node.kind === kind && node.name === name && node.path === path);
        const level = input['level'] as AccessLevel;
        const values = node?.call ? ['inherit', 'deny', 'allow'] : node?.path === '' ? ['inherit', 'deny', 'read', 'edit', 'full'] : ['inherit', 'deny', 'read', 'edit'];
        if (node === undefined || !values.includes(level) || Object.keys(input).some(key => !['subjectKind', 'subject', 'kind', 'name', 'path', 'level'].includes(key))) return yield* new DataValidationError({ message: 'Неизвестный узел или уровень доступа', fields: ['path', 'level'] });
        yield* database.run(remove('platform_access_settings', Object.entries({ subjectKind, subject, kind, name, path }).map(([column, value]) => ({ column, operator: '=' as const, value }))));
        yield* database.run(insert('platform_access_settings', { subjectKind, subject, kind, name, path, level }));
    }
    const settings = yield* database.all<AccessSetting>({ sql: 'SELECT * FROM platform_access_settings', parameters: [] });
    const resolved = guard.rightsFromRoles(subjectKind === 'role' ? [subject] : account!.roles, settings, subjectKind === 'user' ? subject : null);
    const explicit = subjectKind === 'role' ? role!.access.entries : [];
    return {
        subjects: [...guard.roles.map(role => ({ subjectKind: 'role', subject: role.name, title: `Роль: ${role.title}` })), ...accounts.map(account => ({ subjectKind: 'user', subject: account.guid, title: `Пользователь: ${account.name}` }))],
        subjectKind, subject, editable: (yield* guard.rightsOf(user)).allows(platformRights.authorization.write),
        nodes: nodes.map(node => ({ ...node, selected: settings.find(setting => setting.subjectKind === subjectKind && setting.subject === subject && setting.kind === node.kind && setting.name === node.name && setting.path === node.path)?.level ?? explicit.find(entry => entry.target.kind === node.kind && entry.target.name === node.name && entry.path === node.path)?.level ?? 'inherit', effective: (() => { const decision = resolved.decision(node, node.path === '' ? 'fields' : node.path); return { ...decision, sourcePath: decision.source, source: decision.source === 'default' ? 'Разрешение не задано' : decision.source === 'full' ? 'Полный доступ роли' : decision.source === 'object' ? nodes.find(candidate => candidate.kind === node.kind && candidate.name === node.name && candidate.path === '')?.title ?? node.name : nodes.find(candidate => candidate.kind === node.kind && candidate.name === node.name && candidate.path === decision.source)?.title ?? decision.source }; })() })),
    };
});
