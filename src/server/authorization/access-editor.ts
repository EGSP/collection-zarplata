/** Редактор узлов использует тот же расчёт, что диспетчер; код обработчиков не является входом API. */
import { Effect } from 'effect';
import { pageModules } from '../../configuration/configuration.generated.js';
import { Database } from '../database/database.effect.js';
import { insert, remove } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { objectValue, stringValue } from '../data/records.js';
import { DataNotFoundError, DataValidationError } from '../data/data.errors.js';
import { readUserAccounts } from '../users/users.js';
import { loadPages } from '../ui/page-registry.js';
import { describePlatformRights, platformRights } from './rights.js';
import type { RightsGuardPlatform, AccessSetting } from './rights-guard.platform.js';
import type { AccessLevel, AccessTarget } from './access-schema.js';
import { RightsDeniedError } from './authorization.errors.js';

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
    // Проверяем и прямые вызовы API, включая запросы из клиента старой версии.
    const readOnly = subjectKind === 'role' && role?.readOnly === true;
    if (action === 'saveSettings' && readOnly) {
        return yield* new RightsDeniedError({
            message: 'Права этой роли заданы в конфигурации и доступны только для просмотра',
            right: platformRights.authorization.write.key,
            code: 'roleReadOnly',
        });
    }
    const nodes: (AccessTarget & { path: string; title: string; call: boolean })[] = objects.flatMap(object => {
        const internal = new Set(object.access?.entries.filter(entry => entry.path.startsWith('internal.')).map(entry => entry.path.slice(9)) ?? []);
        const node = (path: string, title: string, call = false) => ({ kind: object.kind, name: object.name, path, title, call });
        return [node('', object.title), node('fields', 'Поля'), ...(object.access?.groups ?? []).map(group => node(`groups.${group.name}`, group.title ?? group.name)),
            ...object.fields.filter(field => !internal.has(field.name)).map(field => node(`fields.${field.name}`, field.title)),
            ...object.tableParts.filter(part => !internal.has(part.name)).flatMap(part => [node(`fields.${part.name}`, part.title), ...part.fields.filter(field => !internal.has(`${part.name}.${field.name}`)).map(field => node(`fields.${part.name}.${field.name}`, `${part.title}: ${field.title}`))]),
            node('actions', 'Действия', true), ...(object.kind === 'document' ? [node('actions.post', 'Проведение', true)] : []), ...(object.kind === 'catalog' ? [node('actions.import', 'Импорт', true)] : []), ...object.actions.map(action => node(`actions.${action.name}`, action.title, true)),
            node('functions', 'Функции', true), ...object.functions.map(declared => node(`functions.${declared.name}`, declared.title, true))];
    });
    const pages = yield* loadPages(pageModules);
    nodes.push(
        ...pages.flatMap(page => [
            { kind: 'page' as const, name: page.name, path: '', title: `Страница «${page.title}»`, call: true },
            { kind: 'page' as const, name: page.name, path: 'actions.open', title: 'Открытие', call: true },
        ]),
        ...describePlatformRights().flatMap(section => [
            { kind: section.kind, name: section.name, path: '', title: `Платформа · ${section.title}`, call: true },
            ...section.operations.map(operation => ({ kind: section.kind, name: section.name, path: `actions.${operation.operation}`, title: operation.title, call: true })),
        ]),
    );
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
    const overrides = readOnly ? [] : settings.filter(setting => setting.subjectKind === subjectKind && setting.subject === subject);
    return {
        subjects: [...guard.roles.map(role => ({ subjectKind: 'role', subject: role.name, title: `Роль: ${role.title}` })), ...accounts.map(account => ({ subjectKind: 'user', subject: account.guid, title: `Пользователь: ${account.name}` }))],
        subjectKind, subject, readOnly, editable: !readOnly && (yield* guard.rightsOf(user)).allows(platformRights.authorization.write),
        nodes: nodes.map(node => {
            const configured = explicit.find(entry => entry.target.kind === node.kind && entry.target.name === node.name && entry.path === node.path);
            const override = overrides.find(setting => setting.kind === node.kind && setting.name === node.name && setting.path === node.path);
            const fullAtRoot = subjectKind === 'role' && role!.all && node.path === '';
            const selected = override?.level ?? configured?.level ?? (fullAtRoot ? node.call ? 'allow' : 'full' : 'inherit');
            const path = node.path === '' ? node.call ? 'actions' : 'fields' : node.path;
            const decision = resolved.decision(node, path);
            const sourcePath = decision.source === 'object' ? '' : decision.source;
            const source = decision.source === 'default' ? 'Разрешение не задано' : nodes.find(candidate => candidate.kind === node.kind && candidate.name === node.name && candidate.path === sourcePath)?.title ?? sourcePath;
            return { ...node, selected, effective: { ...decision, sourcePath, source } };
        }),
    };
});
