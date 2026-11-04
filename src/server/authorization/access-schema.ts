import type { StandardFields } from '../metadata/standard-fields.js';
/** Типизированное дерево доступа. Раскладка формы не участвует в наследовании прав. */
import type { ObjectBuilder, TablePartMap } from '../metadata/builders.js';
import type { ObjectKind } from '../metadata/descriptions.js';

export type DataAccess = 'inherit' | 'deny' | 'read' | 'edit';
export type CallAccess = 'inherit' | 'deny' | 'allow';
export type AccessLevel = DataAccess | CallAccess | 'full';
export interface AccessTarget { readonly kind: ObjectKind; readonly name: string }
export interface AccessEntry { readonly target: AccessTarget; readonly path: string; readonly level: AccessLevel }
export interface AccessGroup { readonly target: AccessTarget; readonly name: string; readonly title?: string; readonly fields: readonly string[] }
export interface AccessDefinition { readonly entries: readonly AccessEntry[]; readonly groups: readonly AccessGroup[] }
export const emptyAccess: AccessDefinition = Object.freeze({ entries: [], groups: [] });
type PartFields<Parts extends TablePartMap> = { [Part in keyof Parts & string]: `${Part}.${keyof Parts[Part] & string}` }[keyof Parts & string];
export type AccessField<Builder extends ObjectBuilder> = keyof Builder['~fields'] & string | (Builder['kind'] extends 'catalog' | 'document' ? keyof Builder['~tableParts'] & string | PartFields<Builder['~tableParts']> : never) | keyof StandardFields[Builder['kind']] & string;
type Groups<Builder> = Builder extends { readonly '~accessGroups': infer Names extends string } ? Names : never;

/** Схема не исполняет политику и не даёт права сама по себе: её подключают к роли или обработчику. */
export class AccessSchema implements AccessDefinition {
    constructor(readonly entries: readonly AccessEntry[] = [], readonly groups: readonly AccessGroup[] = []) {}
    object<Builder extends ObjectBuilder>(object: Builder, define: (schema: ObjectAccessSchema<Builder, Groups<Builder>>) => AccessDefinition): AccessSchema {
        const addition = define(new ObjectAccessSchema(object));
        return new AccessSchema([...this.entries, ...addition.entries], [...this.groups, ...addition.groups]);
    }
}

/** Каждый метод возвращает новую схему; более точные узлы не зависят от порядка записи. */
export class ObjectAccessSchema<Builder extends ObjectBuilder, GroupNames extends string = Groups<Builder>> extends AccessSchema {
    declare readonly '~object': Builder;
    declare readonly '~groups': GroupNames;
    readonly target: AccessTarget;
    constructor(target: AccessTarget, entries: readonly AccessEntry[] = [], groups: readonly AccessGroup[] = []) {
        super(entries, groups);
        // Схема хранит адрес, а не билдер: иначе подключение схемы к объекту создаёт цикл.
        this.target = { kind: target.kind, name: target.name };
    }
    private set(path: string, level: AccessLevel): ObjectAccessSchema<Builder, GroupNames> {
        return new ObjectAccessSchema(this.target, [...this.entries.filter(entry => entry.path !== path), { target: this.target, path, level }], this.groups);
    }
    /** full включает вызовы, edit и read относятся только к данным. */
    level(level: DataAccess | 'full'): ObjectAccessSchema<Builder, GroupNames> { return this.set('', level); }
    internal(...fields: readonly AccessField<Builder>[]): ObjectAccessSchema<Builder, GroupNames> {
        return new ObjectAccessSchema(this.target, [...this.entries, ...fields.map(field => ({ target: this.target, path: `internal.${field}`, level: 'deny' as const }))], this.groups);
    }
    fields(level: DataAccess): ObjectAccessSchema<Builder, GroupNames> { return this.set('fields', level); }
    field(name: AccessField<Builder>, level: DataAccess): ObjectAccessSchema<Builder, GroupNames> { return this.set(`fields.${name}`, level); }
    defineGroup<const Name extends string>(name: Name, fields: readonly AccessField<Builder>[], title: string = name): ObjectAccessSchema<Builder, GroupNames | Name> {
        return new ObjectAccessSchema(this.target, this.entries, [...this.groups, { target: this.target, name, title, fields }]);
    }
    group(name: GroupNames, level: DataAccess): ObjectAccessSchema<Builder, GroupNames> { return this.set(`groups.${name}`, level); }
    post(level: Builder['kind'] extends 'document' ? CallAccess : never): ObjectAccessSchema<Builder, GroupNames> { return this.set('actions.post', level); }
    /** Импорт справочника из внешней системы: права на запись справочника и «Внешних связей» импорт объявляет сам. */
    import(level: Builder['kind'] extends 'catalog' ? CallAccess : never): ObjectAccessSchema<Builder, GroupNames> { return this.set('actions.import', level); }
    actions(level: CallAccess): ObjectAccessSchema<Builder, GroupNames> { return this.set('actions', level); }
    functions(level: CallAccess): ObjectAccessSchema<Builder, GroupNames> { return this.set('functions', level); }
    action(name: Builder['kind'] extends 'catalog' | 'document' ? Builder['~actions'] : never, level: CallAccess): ObjectAccessSchema<Builder, GroupNames> { return this.set(`actions.${name}`, level); }
    function(name: Builder['kind'] extends 'catalog' | 'document' | 'register' ? keyof Builder['~functions'] & string : never, level: CallAccess): ObjectAccessSchema<Builder, GroupNames> { return this.set(`functions.${name}`, level); }
}
export function accessSchema(): AccessSchema;
export function accessSchema<Builder extends ObjectBuilder>(object: Builder): ObjectAccessSchema<Builder>;
export function accessSchema(object?: ObjectBuilder): AccessSchema { return object === undefined ? new AccessSchema() : new ObjectAccessSchema(object); }

export interface AccessDecision { readonly level: Exclude<AccessLevel, 'inherit' | 'full'>; readonly source: string; readonly specificity: number }
const priority: Record<Exclude<AccessLevel, 'inherit'>, number> = { deny: 0, read: 1, allow: 1, edit: 2, full: 3 };
/** Объединяем явные настройки узла до наследования: запрет выигрывает при равной точности. */
export function resolveAccess(definitions: readonly AccessDefinition[], target: AccessTarget, path: string, full = false): AccessDecision {
    const same = (candidate: AccessTarget) => candidate.kind === target.kind && candidate.name === target.name;
    const groups = definitions.flatMap(definition => definition.groups).filter(group => same(group.target));
    if (path.startsWith('fields.') && definitions.some(definition => definition.entries.some(entry => same(entry.target) && entry.path.startsWith('internal.') && (path === `fields.${entry.path.slice(9)}` || path.startsWith(`fields.${entry.path.slice(9)}.`))))) return { level: 'deny', source: 'internal', specificity: 1000 };
    const candidates = definitions.flatMap(definition => definition.entries).filter(entry => same(entry.target) && entry.level !== 'inherit').flatMap(entry => {
        let specificity = -1;
        if (entry.path === '') specificity = 0;
        if (path === entry.path) specificity = 100 + entry.path.split('.').length;
        else if (entry.path && path.startsWith(entry.path + '.')) specificity = (entry.path.startsWith('fields.') ? 100 : 10) + entry.path.split('.').length;
        if (entry.path.startsWith('groups.') && path.startsWith('fields.') && groups.some(group => entry.path === `groups.${group.name}` && group.fields.some(field => path === `fields.${field}` || path.startsWith(`fields.${field}.`)))) specificity = 50;
        if (specificity < 0) return [];
        const call = path.startsWith('actions') || path.startsWith('functions');
        if (call && (entry.level === 'read' || entry.level === 'edit')) return [];
        const level = entry.level === 'full' ? (call ? 'allow' : 'edit') : entry.level;
        return [{ level, source: entry.path || 'object', specificity }] as AccessDecision[];
    });
    if (candidates.length === 0) return { level: full ? (path.startsWith('actions') || path.startsWith('functions') ? 'allow' : 'edit') : 'deny', source: full ? 'full' : 'default', specificity: -1 };
    const maximum = Math.max(...candidates.map(candidate => candidate.specificity));
    return candidates.filter(candidate => candidate.specificity === maximum).sort((left, right) => (left.level === 'deny' ? -1 : right.level === 'deny' ? 1 : priority[right.level] - priority[left.level]) || left.source.localeCompare(right.source))[0]!;
}
