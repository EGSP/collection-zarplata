import { Effect } from 'effect';
import { applicationShell } from '../../configuration/shell.js';
import { DataNotFoundError } from '../data/data.errors.js';
import { objectValue, stringValue } from '../data/records.js';
import { Database } from '../database/database.effect.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import type { ShellSubsystem } from '../ui/descriptions.js';
import { readUserAccounts } from '../users/users.js';
import type { AccessExplanation, AccessNode, AccessTree } from './access-descriptions.js';
import { accessAddressKey, accessSubjects, describeAccessNodes, describeEffectiveAccess, indexAccessNodes, type AccessDefinitionNode } from './access-nodes.js';
import type { AccessSetting, RightsGuardPlatform, UserRights } from './rights-guard.platform.js';
import { platformRights } from './rights.js';

/** Место в меню содержит ссылку на настройку или группирует дочерние места. */
interface MenuNode {
    readonly key: string;
    readonly title: string;
    readonly setting: AccessDefinitionNode | null;
    readonly children: readonly MenuNode[];
}

/** Раскладывает общую схему по меню, оставляя каждому повтору объекта или поля собственный ключ. */
function placeAccessNodes(definitions: readonly AccessDefinitionNode[], subsystems: readonly ShellSubsystem[]): MenuNode[] {
    const byTarget = new Map(definitions.map(node => [accessAddressKey(node), node]));
    const included = new Set<string>();

    /** Наследует путь размещения, чтобы повтор настройки не сбрасывал выделение. */
    function place(setting: AccessDefinitionNode, parentKey: string): MenuNode {
        const key = `${parentKey}/${accessAddressKey(setting)}`;
        const children = setting.children.filter(child => child.children.length > 0 || (child.path !== 'actions' && child.path !== 'functions'));
        return { key, title: setting.title, setting, children: children.map(child => place(child, key)) };
    }

    const nodes: MenuNode[] = subsystems.map(subsystem => {
        const key = `subsystem.${subsystem.name}`;
        const children = subsystem.groups.map((group, index) => {
            const groupKey = `${key}/group.${index}`;
            const children = group.items.flatMap((item, itemIndex) => {
                const target = `${item.kind}.${item.name}`;
                const definition = byTarget.get(target);
                if (definition === undefined) return [];
                included.add(target);
                return [place(definition, `${groupKey}/item.${itemIndex}`)];
            });
            return { key: groupKey, title: group.title, setting: null, children };
        });
        return { key, title: subsystem.title, setting: null, children };
    });
    const other = definitions.filter(node => node.kind !== 'platform' && !included.has(accessAddressKey(node)));
    if (other.length > 0) nodes.push({ key: 'other', title: 'Прочее', setting: null, children: other.map(node => place(node, 'other')) });
    nodes.push({ key: 'platform', title: 'Платформа', setting: null, children: definitions.filter(node => node.kind === 'platform').map(node => place(node, 'platform')) });
    return nodes;
}

/** Учитывает сами конечные настройки дерева; повтор адреса не увеличивает охват группы меню. */
function leafSettings(node: MenuNode): AccessDefinitionNode[] {
    if (node.children.length > 0) return node.children.flatMap(leafSettings);
    return node.setting === null ? [] : [node.setting];
}

/** Ищет место в дереве по ключу из ответа tree. */
function findNode(nodes: readonly MenuNode[], key: string): MenuNode | undefined {
    for (const node of nodes) {
        if (node.key === key) return node;
        const child = findNode(node.children, key);
        if (child !== undefined) return child;
    }
    return undefined;
}

/** Считает активных пользователей один раз на поддерево, даже если объект повторяется в меню. */
function treeWithCounts(nodes: readonly MenuNode[], users: readonly UserRights[], index: ReadonlyMap<string, AccessDefinitionNode>): AccessNode[] {
    const decisions = users.map(rights => {
        const allowed = new Map<string, boolean>();
        return (node: AccessDefinitionNode) => {
            const key = accessAddressKey(node);
            const previous = allowed.get(key);
            if (previous !== undefined) return previous;
            const current = describeEffectiveAccess(rights, node, index).level !== 'deny';
            allowed.set(key, current);
            return current;
        };
    });
    /** Объединяет множества учётных записей из дочерних узлов. */
    function visit({ key, title, setting, children }: MenuNode): { node: AccessNode; users: Set<number> } {
        const visited = children.map(visit);
        const allowed = new Set(visited.flatMap(child => [...child.users]));
        if (visited.length === 0 && setting !== null) decisions.forEach((allows, index) => {
            if (allows(setting)) allowed.add(index);
        });
        const address = setting === null ? null : { kind: setting.kind, name: setting.name, path: setting.path };
        return { node: { key, title, address, count: allowed.size, children: visited.map(child => child.node) }, users: allowed };
    }
    return nodes.map(node => visit(node).node);
}

/** Дерево и обзор строятся из той же схемы и назначений, которые проверяет гвард. */
export const accessTreeAction = Effect.fn('authorization.accessTree')(function* (
    action: string, payload: unknown, userGuid: string | null, guard: RightsGuardPlatform, objects: readonly ObjectDescription[],
) {
    if (action !== 'tree' && action !== 'explain') return yield* new DataNotFoundError({ message: `Действие «${action}» для прав доступа не найдено` });
    yield* guard.require(userGuid, platformRights.authorization.read);
    const definitions = yield* describeAccessNodes(objects);
    const index = indexAccessNodes(definitions);
    const nodes = placeAccessNodes(definitions, applicationShell['~subsystems']);
    const accounts = yield* readUserAccounts();
    const active = accounts.filter(account => account.disabledAt === null);
    const database = yield* Database;
    const settings = yield* database.all<AccessSetting>({ sql: 'SELECT * FROM platform_access_settings', parameters: [] });
    const users = new Map(active.map(account => [account.guid, guard.rightsFromRoles(account.roles, settings, account.guid)]));
    if (action === 'tree') {
        return { nodes: treeWithCounts(nodes, [...users.values()], index), subjects: accessSubjects(guard, accounts) } satisfies AccessTree;
    }
    const input = objectValue(payload, 'payload');
    const key = stringValue(input['key'], 'key');
    const selected = findNode(nodes, key);
    if (selected === undefined) return yield* new DataNotFoundError({ message: 'Узел прав доступа не найден' });
    const leaves = selected.setting === null ? [...new Map(leafSettings(selected).map(node => [accessAddressKey(node), node])).values()] : [];
    return {
        key,
        subjects: accessSubjects(guard, active).map(subject => {
            const rights = subject.subjectKind === 'user' ? users.get(subject.subject)! : guard.rightsFromRoles([subject.subject], settings);
            const access = selected.setting === null
                ? { allowed: leaves.filter(node => describeEffectiveAccess(rights, node, index).level !== 'deny').length, total: leaves.length }
                : describeEffectiveAccess(rights, selected.setting, index);
            return { ...subject, access };
        }),
    } satisfies AccessExplanation;
});
