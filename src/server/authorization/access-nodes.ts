import { Effect } from 'effect';
import { pageModules } from '../../configuration/configuration.generated.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { loadPages } from '../ui/page-registry.js';
import type { UserAccount } from '../users/descriptions.js';
import type { AccessLevel, AccessTarget } from './access-schema.js';
import type { AccessAddress, AccessSubject } from './access-descriptions.js';
import { describeObjectRights, describePlatformRights, rightAccessPath } from './rights.js';
import type { RightsGuardPlatform, UserRights } from './rights-guard.platform.js';

/** Узел схемы. Путь настройки сохраняется при любом размещении в дереве. */
export interface AccessDefinitionNode extends AccessAddress {
    readonly title: string;
    readonly call: boolean;
    readonly children: readonly AccessDefinitionNode[];
}

/** Ключ настройки одинаков для всех мест, где показан объект или поле. */
export function accessAddressKey({ kind, name, path }: AccessAddress): string {
    return path === '' ? `${kind}.${name}` : `${kind}.${name}.${path}`;
}

/** Формирует штатные уровни узла для меню и серверной проверки записи. */
export function accessLevels(node: AccessDefinitionNode): readonly AccessLevel[] {
    if (node.call) return ['inherit', 'deny', 'allow'];
    return node.path === '' ? ['inherit', 'deny', 'read', 'edit', 'full'] : ['inherit', 'deny', 'read', 'edit'];
}

/** Перечисляет узлы схемы, даже если некоторые поля размещены в нескольких группах. */
export function indexAccessNodes(roots: readonly AccessDefinitionNode[]): ReadonlyMap<string, AccessDefinitionNode> {
    const index = new Map<string, AccessDefinitionNode>();
    /** Индексирует повтор поля по одному адресу. */
    function visit(node: AccessDefinitionNode): void {
        index.set(accessAddressKey(node), node);
        node.children.forEach(visit);
    }
    roots.forEach(visit);
    return index;
}

/** Дерево схемы без внутренних полей. Группы полей берутся из схемы доступа объекта. */
export const describeAccessNodes = Effect.fn('authorization.describeNodes')(function* (objects: readonly ObjectDescription[]) {
    /** Отделяет адрес настройки от остальных метаданных объекта. */
    function createNode(target: AccessTarget, path: string, title: string, call = false, children: readonly AccessDefinitionNode[] = []): AccessDefinitionNode {
        return { kind: target.kind, name: target.name, path, title, call, children };
    }

    /** Формирует поля, группы и операции одного объекта. */
    function describeObject(object: ObjectDescription): AccessDefinitionNode {
        const internal = object.access?.entries.filter(entry => entry.path.startsWith('internal.')).map(entry => entry.path.slice(9)) ?? [];
        /** Внутренняя табличная часть скрывает также все свои колонки. */
        const visible = (path: string) => !internal.some(field => path === field || path.startsWith(`${field}.`));
        const fields = [
            ...object.fields.filter(field => visible(field.name)).map(field => createNode(object, `fields.${field.name}`, field.title)),
            ...object.tableParts.filter(part => visible(part.name)).map(part => createNode(object, `fields.${part.name}`, part.title, false,
                part.fields.filter(field => visible(`${part.name}.${field.name}`)).map(field => createNode(object, `fields.${part.name}.${field.name}`, field.title)),
            )),
        ];
        const groups = object.access?.groups ?? [];
        const byField = new Map([...indexAccessNodes(fields).values()].map(field => [field.path.slice('fields.'.length), field]));
        const members = new Set(groups.flatMap(group => [...group.fields]));
        /** Часть остаётся в «Полях», если в ней остались колонки вне групп. Адрес части сохраняем для настроек. */
        function ungrouped(field: AccessDefinitionNode): AccessDefinitionNode[] {
            if (members.has(field.path.slice('fields.'.length))) return [];
            if (field.children.length === 0) return [field];
            const children = field.children.flatMap(ungrouped);
            return children.length === 0 ? [field] : [{ ...field, children }];
        }
        const calls = describeObjectRights(object).flatMap(right => {
            const path = rightAccessPath(right.key.split('.').slice(2));
            return path === 'fields' ? [] : [createNode(object, path, right.title, true)];
        });
        return createNode(object, '', object.title, false, [
            createNode(object, 'fields', 'Поля', false, [
                ...groups.map(group => createNode(object, `groups.${group.name}`, group.title ?? group.name, false,
                    [...new Set(group.fields)].flatMap(field => byField.get(field) ?? []))),
                ...fields.flatMap(ungrouped),
            ]),
            createNode(object, 'actions', 'Действия', true, calls.filter(call => call.path.startsWith('actions.'))),
            createNode(object, 'functions', 'Функции', true, calls.filter(call => call.path.startsWith('functions.'))),
        ]);
    }

    const pages = yield* loadPages(pageModules);
    return [
        ...objects.map(describeObject),
        ...pages.map(page => {
            const target = { kind: 'page' as const, name: page.name };
            return createNode(target, '', page.title, true, [createNode(target, 'actions.open', 'Открытие', true)]);
        }),
        ...describePlatformRights().map(section => createNode(section, '', section.title, true,
            section.operations.map(operation => createNode(section, `actions.${operation.operation}`, operation.title, true)))),
    ];
});

/** Общий перечень назначений для пикера и объяснения. */
export function accessSubjects(guard: RightsGuardPlatform, accounts: readonly UserAccount[]): AccessSubject[] {
    return [
        ...accounts.map(account => ({ subjectKind: 'user' as const, subject: account.guid, title: account.name })),
        ...guard.roles.map(role => ({ subjectKind: 'role' as const, subject: role.name, title: role.title })),
    ];
}

/** Одна интерпретация корня и источника для обзора и режима редактирования. */
export function describeEffectiveAccess(rights: UserRights, node: AccessDefinitionNode, index: ReadonlyMap<string, AccessDefinitionNode>) {
    const path = node.path === '' ? node.call ? 'actions' : 'fields' : node.path;
    const decision = rights.decision(node, path);
    const sourcePath = decision.source === 'object' ? '' : decision.source;
    const source = decision.source === 'default' ? 'Разрешение не задано'
        : index.get(accessAddressKey({ ...node, path: sourcePath }))?.title ?? sourcePath;
    // Полный доступ на корне отличается от редактирования тем, что разрешает и группы вызовов.
    const full = node.path === '' && !node.call && decision.level === 'edit' && decision.source === 'object'
        && ['actions', 'functions'].every(group => {
            const call = rights.decision(node, group);
            return call.level === 'allow' && call.source === 'object';
        });
    return { ...decision, level: full ? 'full' as const : decision.level, sourcePath, source };
}
