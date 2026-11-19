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
import type { AccessLevel, AccessTarget } from './access-schema.js';
import type { AccessSettings } from './access-descriptions.js';
import { accessAddressKey, accessLevels, accessSubjects, describeAccessNodes, describeEffectiveAccess, indexAccessNodes } from './access-nodes.js';
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
    const nodes = indexAccessNodes(yield* describeAccessNodes(objects));
    if (action === 'saveSettings') {
        const kind = stringValue(input['kind'], 'kind') as AccessTarget['kind'];
        const name = stringValue(input['name'], 'name');
        const path = typeof input['path'] === 'string' ? input['path'] : '';
        const node = nodes.get(accessAddressKey({ kind, name, path }));
        const level = input['level'] as AccessLevel;
        if (node === undefined || node.kind !== kind || node.name !== name || node.path !== path || !accessLevels(node).includes(level) || Object.keys(input).some(key => !['subjectKind', 'subject', 'kind', 'name', 'path', 'level'].includes(key))) return yield* new DataValidationError({ message: 'Неизвестный узел или уровень доступа', fields: ['path', 'level'] });
        yield* database.run(remove('platform_access_settings', Object.entries({ subjectKind, subject, kind, name, path }).map(([column, value]) => ({ column, operator: '=' as const, value }))));
        yield* database.run(insert('platform_access_settings', { subjectKind, subject, kind, name, path, level }));
    }
    const settings = yield* database.all<AccessSetting>({ sql: 'SELECT * FROM platform_access_settings', parameters: [] });
    const roleNames = subjectKind === 'role' ? [subject] : account!.roles;
    const userGuid = subjectKind === 'user' ? subject : null;
    const resolved = guard.rightsFromRoles(roleNames, settings, userGuid);
    const explicit = subjectKind === 'role' ? role!.access.entries : [];
    /** База для сравнения сохраняет права конфигурации и других назначений. */
    const isOverride = (setting: AccessSetting) => setting.subjectKind === subjectKind && setting.subject === subject;
    const overrides = readOnly ? [] : settings.filter(isOverride);
    const baseline = overrides.length > 0 ? guard.rightsFromRoles(roleNames, settings.filter(setting => !isOverride(setting)), userGuid) : undefined;
    return {
        subjects: accessSubjects(guard, accounts),
        subjectKind, subject, readOnly, editable: !readOnly && (yield* guard.rightsOf(user)).allows(platformRights.authorization.write),
        nodes: [...nodes].map(([key, node]) => {
            const { kind, name, path, title, call } = node;
            const configured = explicit.find(entry => accessAddressKey({ ...entry.target, path: entry.path }) === key);
            const override = overrides.find(setting => accessAddressKey(setting) === key);
            const fullAtRoot = subjectKind === 'role' && role!.all && path === '';
            const selected = override?.level ?? configured?.level ?? (fullAtRoot ? call ? 'allow' : 'full' : 'inherit');
            const effective = describeEffectiveAccess(resolved, node, nodes);
            const differsFromBaseline = baseline !== undefined && describeEffectiveAccess(baseline, node, nodes).level !== effective.level;
            return { kind, name, path, title, call, levels: accessLevels(node), selected, differsFromBaseline, effective };
        }),
    } satisfies AccessSettings;
});
