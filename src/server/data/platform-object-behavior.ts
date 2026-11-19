import type { Effect } from 'effect';
import type { Database } from '../database/database.effect.js';
import type { JournalChanges } from '../journal/descriptions.js';

type RecordValue = Record<string, unknown>;

/** Дополняет общие действия встроенного объекта без замены чтения и записи его таблиц. */
export interface PlatformObjectBehavior {
    /** Стандартные действия, которые встроенный объект исключает из API и формы. */
    readonly unavailableActions: readonly string[];
    /** Проверяет и приводит вход к каноническому виду после проверки схемы и прав. */
    readonly prepareSave: (input: RecordValue, previous: RecordValue | undefined) => Effect.Effect<RecordValue, unknown>;
    /** Обновляет служебные данные в той же транзакции после штатной записи. */
    readonly afterSave: (record: RecordValue, previous: RecordValue | undefined) => Effect.Effect<void, unknown, Database>;
    /** Привязывает собственное действие к записи и выбирает только безопасные сведения для истории. */
    readonly actionJournal: (action: string, input: RecordValue) => { readonly guid: string; readonly changes: JournalChanges | null };
}
