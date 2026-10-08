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
import { select } from '../database/sql.builder.js';
import type { ObjectDescription, ObjectReferenceValue } from '../metadata/descriptions.js';
import type { ListColumn } from '../ui/descriptions.js';
import { columnReference, presentationSource, recordPresentation, referenceKey, type ReferencePresentations } from '../ui/reference-presentation.js';
import { tableName, type RecordValue } from './records.js';

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
     * Готовит представления самих записей порции для отбора по представлению. Собственное
     * представление строится из записи без чтения, поэтому базу метод читает только для
     * справочника с представлением по ссылке: целевые записи порции одним пакетом.
     */
    loadOwn(object: ObjectDescription, records: ReadonlyArray<RecordValue>): Effect.Effect<void, DatabaseError, Database> {
        const references: Array<ObjectReferenceValue> = [];
        for (const record of records) {
            const source = presentationSource(object.presentation, record);
            if (source !== null) references.push(source);
        }
        return this.loadReferences(references);
    }

    /**
     * Читает записи по ссылкам, группируя их по целевым объектам. У справочника с представлением
     * по ссылке вместо наименования читается поле-источник, а целевые записи дочитываются
     * повторным вызовом. Глубже одного уровня он не уходит: цепочки отклоняет `commit()`.
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
            // Записи, которые получат представление своей целевой записи после её чтения.
            const delegated: Array<{ readonly key: string; readonly source: ObjectReferenceValue }> = [];
            for (const [object, group] of groups) {
                const guids = [...group.keys()];
                const columns = object.presentation !== null ? ['guid', object.presentation.field]
                    : object.kind === 'document' ? ['guid', 'number', 'date'] : ['guid', 'name'];
                // Размер пакета ограничивает число параметров SQL, даже если у списка много ссылочных колонок.
                for (let start = 0; start < guids.length; start += 500) {
                    const selection = select(tableName(object), { columns });
                    const identifiers = guids.slice(start, start + 500);
                    // Turso ограничивает глубину выражения сотней узлов: пакет из OR превышает её,
                    // а IN хранит значения списком. Все GUID по-прежнему передаются параметрами.
                    const rows = yield* database.all<RecordValue>({
                        sql: `${selection.sql} WHERE "guid" IN (${identifiers.map(() => '?').join(', ')})`,
                        parameters: identifiers,
                    });
                    for (const row of rows) {
                        const reference = group.get(row['guid'] as string)!;
                        const source = presentationSource(object.presentation, row);
                        if (source !== null) delegated.push({ key: referenceKey(reference), source });
                        else if (object.presentation === null) this.cache.set(referenceKey(reference), recordPresentation({ ...reference, title: object.title }, row));
                    }
                }
            }
            if (delegated.length === 0) return;
            yield* this.loadReferences(delegated.map((item) => item.source));
            // Недоступная или отсутствующая целевая запись оставляет исходную без текста.
            for (const item of delegated) this.cache.set(item.key, this.cache.get(referenceKey(item.source)) ?? null);
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
