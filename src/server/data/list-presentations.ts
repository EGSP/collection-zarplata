/**
 * Чтение представлений для одного запроса списка. Кеш живёт только до завершения запроса:
 * поиск и выбранная страница используют один текст, а следующий запрос видит новые названия.
 * Права проверяются до чтения целевой таблицы; недоступная ссылка не участвует в поиске.
 */
import { Effect } from 'effect';
import { readRight } from '../authorization/rights.js';
import type { UserRights } from '../authorization/rights-guard.platform.js';
import { Database } from '../database/database.effect.js';
import { select } from '../database/sql.builder.js';
import type { ObjectDescription, ObjectReferenceValue } from '../metadata/descriptions.js';
import type { ListColumn } from '../ui/descriptions.js';
import { columnReference, recordPresentation, referenceKey, type ReferencePresentations } from '../ui/reference-presentation.js';
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
     * Читает ещё не встречавшиеся ссылки порции, группируя их по целевым объектам.
     * Принимает записи после восстановления типов из SQL. Требует базу текущей транзакции
     * в окружении Effect; ошибка чтения завершает весь запрос ошибкой базы.
     */
    load = Effect.fnUntraced(function* (this: ListPresentations, records: ReadonlyArray<RecordValue>) {
        const database = yield* Database;
        const groups = new Map<ObjectDescription, Map<string, ObjectReferenceValue>>();
        for (const record of records) {
            for (const column of this.columns) {
                const reference = columnReference(column, record[column.field]);
                if (reference === null) continue;
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
        }
        for (const [object, references] of groups) {
            const guids = [...references.keys()];
            // Размер пакета ограничивает число параметров SQL, даже если у списка много ссылочных колонок.
            for (let start = 0; start < guids.length; start += 500) {
                const selection = select(tableName(object), {
                    columns: object.kind === 'document' ? ['guid', 'number', 'date'] : ['guid', 'name'],
                });
                const identifiers = guids.slice(start, start + 500);
                // Turso ограничивает глубину выражения сотней узлов: пакет из OR превышает её,
                // а IN хранит значения списком. Все GUID по-прежнему передаются параметрами.
                const rows = yield* database.all<RecordValue>({
                    sql: `${selection.sql} WHERE "guid" IN (${identifiers.map(() => '?').join(', ')})`,
                    parameters: identifiers,
                });
                for (const row of rows) {
                    const reference = references.get(row['guid'] as string)!;
                    this.cache.set(referenceKey(reference), recordPresentation({ ...reference, title: object.title }, row));
                }
            }
        }
    });

    /** Доступный текст ссылки либо null, когда ссылка пуста, запись отсутствует или чтение запрещено. */
    text(column: ListColumn, record: RecordValue): string | null {
        const reference = columnReference(column, record[column.field]);
        return reference === null ? null : this.cache.get(referenceKey(reference)) ?? null;
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
