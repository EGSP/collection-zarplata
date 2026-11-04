import { isDeepStrictEqual } from 'node:util';
/** Контекст полномочий существует только в Effect текущего серверного вызова. */
import { Context, Effect } from 'effect';
import type { AccessDefinition, AccessTarget, DataAccess } from './access-schema.js';
import { resolveAccess } from './access-schema.js';
import { RightsDeniedError } from './authorization.errors.js';
import type { UserRights } from './rights-guard.platform.js';
import type { ObjectDescription, FieldDescription } from '../metadata/descriptions.js';
import type { SqlQuery } from '../database/sql.builder.js';
import type { RecordValue } from '../data/records.js';

export interface ExecutionAccess {
    readonly user: UserRights;
    readonly objects?: readonly ObjectDescription[];
    readonly extensions: readonly AccessDefinition[];
    readonly chain: readonly string[];
    /** Общая отметка всех вложенных чтений: скрытые исходные данные не становятся публичным результатом. */
    readonly disclosure: { sensitive: boolean };
}
export class AccessExecution extends Context.Service<AccessExecution, ExecutionAccess>()('AccessExecution') {}
export function dataLevel(access: ExecutionAccess, target: AccessTarget, field?: string, direct = false): DataAccess {
    const path = field === undefined ? 'fields' : `fields.${field}`;
    const own = access.user.decision(target, path).level;
    if (direct) return own === 'edit' || own === 'read' ? own : 'deny';
    const extra = resolveAccess(access.extensions, target, path).level;
    return own === 'edit' || extra === 'edit' ? 'edit' : own === 'read' || extra === 'read' ? 'read' : 'deny';
}
/** Отказ не содержит значения поля, GUID отсутствующей записи или SQL. */
export function accessDenied(access: ExecutionAccess, target: AccessTarget, path: string, required: string, actual: string): RightsDeniedError {
    const object = access.objects?.find(object => object.kind === target.kind && object.name === target.name);
    const fieldPath = path.startsWith('fields.') ? path.slice(7) : path;
    const [partName, columnName] = fieldPath.split('.');
    const field = columnName === undefined ? object?.fields.find(field => field.name === partName) : object?.tableParts.find(part => part.name === partName)?.fields.find(field => field.name === columnName);
    const group = object?.access?.groups.find(group => group.fields.some(name => fieldPath === name || fieldPath.startsWith(name + '.')));
    const place = field === undefined ? `узла «${path}»` : `поля «${field.title}»${group === undefined ? '' : ` в группе «${group.title ?? group.name}»`}`;
    const operation = required === 'edit' ? 'изменение' : required === 'read' ? 'чтение' : 'вызов';
    const level = actual === 'read' ? 'только чтение' : actual === 'edit' ? 'редактирование' : 'запрет';
    return new RightsDeniedError({ code: 'ACCESS_DENIED', target, path, required, actual, chain: access.chain,
        right: `${target.kind}.${target.name}.${path}`, message: `Не удалось выполнить действие${object === undefined ? '' : ` с объектом «${object.title}»`}: запрещено ${operation} ${place}. Доступ: ${level}. Цепочка: ${access.chain.join(' → ')}.` });
}
/** Необъявленный SQL не получает доступ к служебным таблицам из прикладного обработчика. */
export function requireQuery(access: ExecutionAccess, query: SqlQuery): void {
    if (query.access === undefined) throw accessDenied(access, { kind: 'catalog', name: 'database' }, 'query', 'read', 'deny');
    const target = query.access;
    if (query.access.fields.length === 0 && dataLevel(access, target, undefined, true) === 'deny') access.disclosure.sensitive = true;
    if (dataLevel(access, target) === 'deny' && query.access.fields.length === 0) throw accessDenied(access, target, 'fields', 'read', 'deny');
    for (const field of query.access.fields) {
        const actual = dataLevel(access, target, field);
        if (actual === 'deny') throw accessDenied(access, target, `fields.${field}`, 'read', actual);
        if (dataLevel(access, target, field, true) === 'deny') access.disclosure.sensitive = true;
    }
}
/** Публичный ответ отделяет недоступное поле от незаполненного: значения запретных узлов отсутствуют. */
export function publicRecord(description: ObjectDescription, record: RecordValue, access: ExecutionAccess, direct = true): RecordValue {
    const result: RecordValue = {};
    const availability: RecordValue = {};
    const internal = new Set(description.access?.entries.filter(entry => entry.path.startsWith('internal.')).map(entry => entry.path.slice(9)) ?? []);
    for (const field of description.fields) {
        if (internal.has(field.name)) continue;
        const level = dataLevel(access, description, field.name, direct);
        availability[field.name] = level;
        if (level !== 'deny' && field.name in record) { result[field.name] = record[field.name]; if (!direct && dataLevel(access, description, field.name, true) === 'deny') access.disclosure.sensitive = true; }
    }
    for (const part of description.tableParts) {
        if (internal.has(part.name)) continue;
        const rows = record[part.name];
        availability[part.name] = dataLevel(access, description, part.name, direct);
        for (const field of part.fields) { const path = `${part.name}.${field.name}`; if (!internal.has(path)) availability[path] = dataLevel(access, description, path, direct); }
        if (!part.fields.some(field => !internal.has(`${part.name}.${field.name}`) && dataLevel(access, description, `${part.name}.${field.name}`, direct) !== 'deny')) continue;
        if (Array.isArray(rows)) result[part.name] = rows.map(row => Object.fromEntries(part.fields.flatMap(field => {
            const path = `${part.name}.${field.name}`;
            if (internal.has(path)) return [];
            const level = dataLevel(access, description, path, direct); availability[path] = level;
            if (!direct && level !== 'deny' && dataLevel(access, description, path, true) === 'deny') access.disclosure.sensitive = true;
            return level === 'deny' ? [] : [[field.name, row[field.name]]];
        })));
    }
    if (description.fields.every(field => dataLevel(access, description, field.name, direct) !== 'deny') && record['$presentation'] !== undefined) result['$presentation'] = record['$presentation'];
    if (direct) result['$access'] = availability;
    return result;
}
/** Пропущенные недоступные поля сохраняются, переданные сравниваются с актуальными данными транзакции. */
export function writableInput(description: ObjectDescription, input: RecordValue, existing: RecordValue | undefined, access: ExecutionAccess): RecordValue {
    const merged = { ...input };
    const same = (left: unknown, right: unknown) => isDeepStrictEqual(left ?? null, right ?? null);
    const initial = (field: FieldDescription): unknown => field.initial ?? (field.required && field.kind === 'boolean' ? false : field.required && field.kind === 'dateTime' ? new Date().toISOString() : null);
    for (const field of description.fields.filter(field => !field.managed && field.computed == null)) {
        const level = dataLevel(access, description, field.name);
        if (level === 'edit') continue;
        if (field.name in input && !same(input[field.name], existing === undefined ? initial(field) : existing[field.name])) throw accessDenied(access, description, `fields.${field.name}`, 'edit', level);
        if (existing !== undefined) merged[field.name] = existing[field.name];
        else if (!(field.name in merged)) merged[field.name] = initial(field);
    }
    for (const part of description.tableParts) {
        if (!(part.name in input) && existing !== undefined) { merged[part.name] = existing[part.name]; continue; }
        const before = (existing?.[part.name] ?? []) as RecordValue[];
        const after = (input[part.name] ?? []) as RecordValue[];
        for (const field of part.fields.filter(field => field.computed == null)) {
            const level = dataLevel(access, description, `${part.name}.${field.name}`);
            if (level === 'edit') continue;
            if (existing === undefined) {
                for (let index = 0; index < after.length; index++) {
                    if (field.name in after[index]! && !same(after[index]![field.name], initial(field))) throw accessDenied(access, description, `fields.${part.name}.${field.name}`, 'edit', level);
                    after[index] = { ...after[index], [field.name]: initial(field) };
                }
                continue;
            }
            if (before.length !== after.length) throw accessDenied(access, description, `fields.${part.name}.${field.name}`, 'edit', level);
            for (let index = 0; index < after.length; index++) {
                if (field.name in after[index]! && !same(after[index]![field.name], before[index]?.[field.name])) throw accessDenied(access, description, `fields.${part.name}.${field.name}`, 'edit', level);
                after[index] = { ...after[index], [field.name]: before[index]?.[field.name] };
            }
        }
        merged[part.name] = after;
    }
    return merged;
}
/** Сервисный отказ остаётся причиной 403, а не маскируется ошибкой SQL. */
export const checkQuery = (access: ExecutionAccess, query: SqlQuery) => Effect.sync(() => requireQuery(access, query));

/** Диспетчер устанавливает контекст до любых чтений и проверок обработчика. */
export const currentAccess = Effect.flatMap(Effect.serviceOption(AccessExecution), option => option._tag === 'Some' ? Effect.succeed(option.value) : Effect.die(new Error('Нет контекста доступа')));
