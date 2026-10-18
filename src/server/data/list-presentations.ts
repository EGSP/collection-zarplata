/**
 * Чтение представлений для одного запроса списка. Кеш живёт только до завершения запроса:
 * поиск и выбранная страница используют один текст, а следующий запрос видит новые названия.
 * Права проверяются до чтения целевой таблицы; недоступная ссылка не участвует в поиске.
 *
 * Запись справочника с представлением по ссылке называется представлением другой записи.
 * Такие целевые записи дочитываются вторым пакетом, а не запросом на каждую строку: число
 * запросов зависит от числа объектов, на которые ссылается порция, а не от числа её строк.
 */
import { Effect } from 'effect';
import { readRight } from '../authorization/rights.js';
import type { UserRights } from '../authorization/rights-guard.platform.js';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { query } from '../database/sql.builder.js';
import type { ObjectDescription, ObjectReferenceValue, ObjectTarget } from '../metadata/descriptions.js';
import type { ListColumn } from '../ui/descriptions.js';
import { columnReference, presentationSource, recordPresentation, referenceKey, type ReferencePresentations } from '../ui/reference-presentation.js';
import { formatSearchValue, formatDate, formatDateTime } from '../ui/value-format.js';
import type { RecordValue } from './records.js';

/** Объекты, на записи которых ссылается представление записей объекта: по ссылке или из своих полей и частей. */
function presentationTargets(object: ObjectDescription): ReadonlyArray<ObjectTarget> {
    const targets: Array<ObjectTarget> = object.presentation === null ? [] : [object.presentation.target];
    for (const part of object.presentationParts) {
        if ('text' in part) continue;
        const fields = 'tablePart' in part ? object.tableParts.find((candidate) => candidate.name === part.tablePart)?.fields ?? [] : object.fields;
        const field = fields.find((candidate) => candidate.name === part.field);
        if (field?.kind === 'reference' && field.target !== null) targets.push(field.target);
    }
    return targets;
}

/**
 * Порядок чтения объектов: объект идёт после объектов, на которые ссылается его представление.
 * Циклы представлений отклоняет `commit()`, поэтому порядок существует; ссылки на объекты
 * вне набора на порядок не влияют.
 */
function presentationOrder(objects: ReadonlyArray<ObjectDescription>): ReadonlyArray<ObjectDescription> {
    const ordered: Array<ObjectDescription> = [];
    const remaining = [...objects];
    const waitsFor = (object: ObjectDescription) => presentationTargets(object)
        .some((target) => remaining.some((other) => other !== object && other.kind === target.kind && other.name === target.name));
    while (remaining.length > 0) {
        // Без найденного объекта порядок не важен: в наборе остался цикл, которого не пропускает `commit()`.
        const index = Math.max(0, remaining.findIndex((object) => !waitsFor(object)));
        ordered.push(...remaining.splice(index, 1));
    }
    return ordered;
}

/** Кеш и пакетное чтение ссылок списка в транзакции вызывающего действия. */
export class ListPresentations {
    private readonly cache = new Map<string, string | null>();

    constructor(
        private readonly objects: ReadonlyArray<ObjectDescription>,
        private readonly rights: UserRights,
        private readonly columns: ReadonlyArray<ListColumn>,
    ) {}

    /**
     * Читает ещё не встречавшиеся ссылки из колонок порции. Принимает записи после восстановления
     * типов из SQL. Требует базу текущей транзакции в окружении Effect; ошибка чтения завершает
     * весь запрос ошибкой базы.
     */
    load(records: ReadonlyArray<RecordValue>): Effect.Effect<void, DatabaseError, Database> {
        const references: Array<ObjectReferenceValue> = [];
        for (const record of records) {
            for (const column of this.columns) {
                const reference = columnReference(column, record[column.field]);
                if (reference !== null) references.push(reference);
            }
        }
        return this.loadReferences(references);
    }

    /**
     * Готовит представления самих записей порции. Читает используемые табличные части и
     * ссылки пакетами, не добавляя строки частей в ответ списка. Уже загруженные части
     * записи повторно не читает. Результат помещает в служебное поле `$presentation`.
     */
    loadOwn(object: ObjectDescription, records: ReadonlyArray<RecordValue>): Effect.Effect<void, DatabaseError, Database> {
        const references: Array<ObjectReferenceValue> = [];
        for (const record of records) {
            const source = presentationSource(object.presentation, record);
            if (source !== null) references.push(source);
        }
        return Effect.gen(function* (this: ListPresentations) {
            const database = yield* Database;
            const guids = records.map((record) => record['guid'] as string);
            const loaded = records.map((record) => ({ ...record }));
            // Для представления читаются только используемые колонки частей, одним пакетом на часть.
            const partNames = new Set(object.presentationParts.flatMap((part) => 'tablePart' in part ? [part.tablePart] : []));
            for (const name of partNames) {
                const part = object.tableParts.find((candidate) => candidate.name === name)!;
                if (loaded.every((record) => Array.isArray(record[name]))) continue;
                const usedFields = part.fields.filter((field) => object.presentationParts.some((piece) => 'tablePart' in piece && piece.tablePart === name && piece.field === field.name));
                const owners = new Map(loaded.map((record) => [record['guid'], record]));
                for (const record of loaded) record[name] = [];
                for (let start = 0; start < guids.length; start += 500) {
                    const identifiers = guids.slice(start, start + 500);
                    const rows = yield* database.all<RecordValue>(query(object).tablePart(name).select({
                        columns: ['ownerGuid', 'lineNumber', ...usedFields.map((field) => field.name)],
                        where: [{ column: 'ownerGuid', operator: 'IN', value: identifiers }],
                        orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
                    }));
                    for (const row of rows) {
                        const owner = owners.get(row['ownerGuid']);
                        if (owner !== undefined) (owner[name] as RecordValue[]).push(Object.fromEntries(usedFields.map((field) => [field.name, row[field.name]])));
                    }
                }
            }
            for (const record of loaded) {
                for (const part of object.presentationParts) {
                    if ('text' in part) continue;
                    const fields = 'tablePart' in part ? object.tableParts.find((candidate) => candidate.name === part.tablePart)!.fields : object.fields;
                    const field = fields.find((candidate) => candidate.name === part.field)!;
                    const rows = 'tablePart' in part ? record[part.tablePart] as RecordValue[] : [record];
                    for (const row of rows) {
                        const reference = columnReference(field, row[field.name]);
                        if (reference !== null) references.push(reference);
                    }
                }
            }
            yield* this.loadReferences(references);
            for (const [index, record] of loaded.entries()) {
                let text: string | null;
                const source = presentationSource(object.presentation, record);
                if (source !== null) text = this.cache.get(referenceKey(source)) ?? null;
                else if (object.presentationParts.length === 0) text = recordPresentation({ kind: object.kind as 'catalog' | 'document', name: object.name, title: object.title }, record);
                else text = object.presentationParts.map((part) => {
                    if ('text' in part) return part.text;
                    const fields = 'tablePart' in part ? object.tableParts.find((candidate) => candidate.name === part.tablePart)!.fields : object.fields;
                    const field = fields.find((candidate) => candidate.name === part.field)!;
                    const rows = 'tablePart' in part ? record[part.tablePart] as RecordValue[] : [record];
                    return rows.map((row) => {
                        const value = row[field.name];
                        const reference = columnReference(field, value);
                        if (reference !== null) return this.cache.get(referenceKey(reference)) ?? 'Запись недоступна';
                        if ('format' in part && part.format === 'number') return value == null ? '' : formatSearchValue('number', typeof value === 'string' ? Number(value) : value) ?? '';
                        if ('format' in part && part.format !== undefined && typeof value === 'string') return part.format === 'date' ? formatDate(value) : formatDateTime(value);
                        return formatSearchValue(field.kind, value) ?? '';
                    }).join('separator' in part ? part.separator ?? ', ' : ', ');
                }).join('');
                records[index]!['$presentation'] = text;
                this.cache.set(referenceKey({ kind: object.kind as 'catalog' | 'document', name: object.name, guid: record['guid'] as string }), text);
            }
        }.bind(this));
    }

    /**
     * Читает записи по ссылкам, группируя их по целевым объектам, и строит их представления.
     * Кеш резервирует ссылку до рекурсивного чтения: повторная ссылка, включая полный адрес
     * записи, не вызывает бесконечного обхода. Статические циклы отклоняет `commit()`.
     */
    private loadReferences(references: ReadonlyArray<ObjectReferenceValue>): Effect.Effect<void, DatabaseError, Database> {
        return Effect.gen(function* (this: ListPresentations) {
            const database = yield* Database;
            const groups = new Map<ObjectDescription, Map<string, ObjectReferenceValue>>();
            for (const reference of references) {
                const key = referenceKey(reference);
                if (this.cache.has(key)) continue;
                // Даже отсутствующие и недоступные записи проверяются только один раз за запрос.
                this.cache.set(key, null);
                const object = this.objects.find((candidate) => candidate.kind === reference.kind && candidate.name === reference.name);
                if (object === undefined || !this.rights.allows(readRight(object))) continue;
                const group = groups.get(object) ?? new Map<string, ObjectReferenceValue>();
                group.set(reference.guid, reference);
                groups.set(object, group);
            }
            // Группы читаются после тех, на которые ссылаются их представления: ссылки уже
            // зарезервированы в кеше, и представление смены, прочитанной раньше сотрудников порции,
            // нашло бы их пустыми и показало «Запись недоступна».
            for (const object of presentationOrder([...groups.keys()])) {
                const group = groups.get(object)!;
                const guids = [...group.keys()];
                for (let start = 0; start < guids.length; start += 500) {
                    const identifiers = guids.slice(start, start + 500);
                    const rows = yield* database.all<RecordValue>(query(object).select({
                        where: [{ column: 'guid', operator: 'IN', value: identifiers }],
                    }));
                    yield* this.loadOwn(object, rows);
                }
            }
        }.bind(this));
    }

    /** Доступный текст ссылки либо null, когда ссылка пуста, запись отсутствует или чтение запрещено. */
    text(column: ListColumn, record: RecordValue): string | null {
        const reference = columnReference(column, record[column.field]);
        return reference === null ? null : this.cache.get(referenceKey(reference)) ?? null;
    }

    /**
     * Представление самой записи справочника или документа. Для справочника с представлением
     * по ссылке перед вызовом нужен `loadOwn`; без доступной целевой записи возвращает null.
     */
    ownText(object: ObjectDescription & { readonly kind: 'catalog' | 'document' }, record: RecordValue): string | null {
        if (Object.hasOwn(record, '$presentation')) return record['$presentation'] as string | null;
        if (object.presentation === null) return recordPresentation(object, record);
        const source = presentationSource(object.presentation, record);
        return source === null ? null : this.cache.get(referenceKey(source)) ?? null;
    }

    /** Возвращает только представления ссылок выбранной страницы, не раскрывая остальные совпадения. */
    forPage(records: ReadonlyArray<RecordValue>): ReferencePresentations {
        const presentations: Record<string, string | null> = {};
        for (const record of records) {
            for (const column of this.columns) {
                const reference = columnReference(column, record[column.field]);
                if (reference !== null) presentations[referenceKey(reference)] = this.cache.get(referenceKey(reference)) ?? null;
            }
        }
        return presentations;
    }
}
