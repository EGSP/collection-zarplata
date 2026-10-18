import { Effect } from 'effect';
import { pageModules } from '../../configuration/configuration.generated.js';
import { applicationShell } from '../../configuration/shell.js';
import { DataNotFoundError } from '../data/data.errors.js';
import { objectValue, stringValue } from '../data/records.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import type { ShellSubsystem } from '../ui/descriptions.js';
import { loadPages } from '../ui/page-registry.js';
import { readUserAccounts } from '../users/users.js';
import type { UserAccount } from '../users/descriptions.js';
import type { AccessExplanation, AccessNode, AccessUser } from './access-descriptions.js';
import { RightsGuardPlatform } from './rights-guard.platform.js';
import { describeObjectRights, pageOpenRight, platformRights } from './rights.js';

/** Ключ обозначает место в дереве; right хранит право независимо от повторов объекта в меню. */
interface RightNode {
    readonly key: string;
    readonly title: string;
    readonly right: string | null;
    readonly children: readonly RightNode[];
}

/** Названия служебных разделов; сами права читаются из platformRights, поэтому новые не теряются. */
const platformTitles: Readonly<Record<keyof typeof platformRights, string>> = {
    authorization: 'Права доступа', users: 'Пользователи', journal: 'Журнал действий', documents: 'Документы',
};

function leaf(key: string, title: string): RightNode {
    return { key, title, right: key, children: [] };
}

/** Полные метаданные сервера, без отбора по прикладным правам просматривающего пользователя. */
export const describeAccessTree = Effect.fn('authorization.describeTree')(function* (
    objects: readonly ObjectDescription[], subsystems: readonly ShellSubsystem[] = applicationShell['~subsystems'],
) {
    const pages = yield* loadPages(pageModules);
    const definitions: RightNode[] = [
        ...objects.map((object) => ({
            key: `${object.kind}.${object.name}`, title: object.title, right: null,
            children: describeObjectRights(object).map((right) => leaf(right.key, right.title)),
        })),
        ...pages.map((page) => ({ key: `page.${page.name}`, title: page.title, right: null, children: [leaf(pageOpenRight(page.name).key, 'Открытие')] })),
    ];
    const byTarget = new Map(definitions.map((node) => [node.key, node]));
    const included = new Set<string>();
    // Объект может встречаться в нескольких группах: каждому месту нужен собственный ключ Tree.
    function placed(node: RightNode, parentKey: string): RightNode {
        const key = `${parentKey}/${node.key}`;
        return { ...node, key, children: node.children.map((child) => placed(child, key)) };
    }
    const nodes: RightNode[] = subsystems.map((subsystem) => ({
        key: `subsystem.${subsystem.name}`, title: subsystem.title, right: null,
        children: subsystem.groups.map((group, index) => {
            const key = `subsystem.${subsystem.name}/group.${index}`;
            return { key, title: group.title, right: null, children: group.items.flatMap((item, itemIndex) => {
                const target = `${item.kind}.${item.name}`;
                const definition = byTarget.get(target);
                if (definition === undefined) return [];
                included.add(target);
                return [placed(definition, `${key}/item.${itemIndex}`)];
            }) };
        }),
    }));
    const other = definitions.filter((node) => !included.has(node.key));
    if (other.length > 0) nodes.push({ key: 'other', title: 'Прочее', right: null, children: other.map((node) => placed(node, 'other')) });
    nodes.push({ key: 'platform', title: 'Платформа', right: null,
        children: (Object.keys(platformRights) as (keyof typeof platformRights)[]).map((name) => ({
            key: `platform.${name}`, title: platformTitles[name], right: null,
            children: Object.entries(platformRights[name]).map(([permission, right]) => leaf(right.key,
                permission === 'read' ? 'Чтение' : permission === 'write' ? 'Запись' : permission === 'repost' ? 'Перепроведение документов' : permission)),
        })),
    });
    return nodes;
});

/**
 * Снимок доступа на время одной транзакции. У каждого узла храним множество guid,
 * поэтому группы считают объединение пользователей и никогда не складывают счётчики детей.
 */
export function accessSnapshot(nodes: readonly RightNode[], accounts: readonly UserAccount[], guard: RightsGuardPlatform) {
    const active = accounts.filter((account) => account.disabledAt === null).map((account) => ({ account, rights: guard.rightsFromRoles(account.roles) }));
    const configuredRoles = guard.roles.map((role) => ({ role, rights: guard.rightsFromRoles([role.name]) }));
    const byKey = new Map<string, { readonly node: AccessNode; readonly leaves: readonly { readonly key: string; readonly title: string }[] }>();
    function visit(source: RightNode, path: readonly string[]): { readonly node: AccessNode; readonly users: ReadonlySet<string> } {
        const fullPath = [...path, source.title];
        const children = source.children.map((child) => visit(child, fullPath));
        const permission = source.right;
        const users = permission === null
            ? new Set(children.flatMap((child) => [...child.users]))
            : new Set(active.filter((user) => user.rights.allows({ key: permission })).map((user) => user.account.guid));
        const node: AccessNode = { ...source, count: users.size, children: children.map((child) => child.node) };
        // Повторы одного объекта в группах не дублируют право в объяснении подсистемы.
        const leaves = source.right === null
            ? [...new Map(source.children.flatMap((child) => byKey.get(child.key)?.leaves ?? []).map((right) => [right.key, right])).values()]
            : [{ key: source.right, title: fullPath.join(' → ') }];
        byKey.set(source.key, { node, leaves });
        return { node, users };
    }
    const tree = nodes.map((node) => visit(node, []).node);
    return {
        tree,
        explain(key: string): AccessExplanation | undefined {
            const selected = byKey.get(key);
            if (selected === undefined) return undefined;
            const users: AccessUser[] = active.flatMap(({ account, rights }) => {
                const permissions = selected.leaves.flatMap((right) => {
                    const roles = rights.grantedBy(right).map(({ name, title, all }) => ({ name, title, all }));
                    return roles.length === 0 ? [] : [{ ...right, roles }];
                });
                return permissions.length === 0 ? [] : [{ guid: account.guid, name: account.name, rights: permissions }];
            });
            const { children: _, ...node } = selected.node;
            const roles = configuredRoles.flatMap(({ role, rights }) => {
                const permissions = selected.leaves.filter((right) => rights.allows(right));
                return permissions.length === 0 ? [] : [{ name: role.name, title: role.title, all: role.all, rights: permissions }];
            });
            return { node, users, roles };
        },
    };
}

/** Оба чтения защищены одним серверным правом и используют те же назначения, что вход и RBAC. */
export const accessTreeAction = Effect.fn('authorization.accessTree')(function* (
    action: string, payload: unknown, userGuid: string | null, guard: RightsGuardPlatform, objects: readonly ObjectDescription[],
) {
    if (!['tree', 'explain'].includes(action)) return yield* new DataNotFoundError({ message: `Действие «${action}» для прав доступа не найдено` });
    yield* guard.require(userGuid, platformRights.authorization.read);
    const nodes = yield* describeAccessTree(objects);
    const accounts = yield* readUserAccounts();
    const snapshot = accessSnapshot(nodes, accounts, guard);
    if (action === 'tree') return { nodes: snapshot.tree };
    const input = objectValue(payload, 'payload');
    const key = stringValue(input['key'], 'key');
    const explanation = snapshot.explain(key);
    if (explanation === undefined) return yield* new DataNotFoundError({ message: 'Узел прав доступа не найден' });
    return explanation;
});
