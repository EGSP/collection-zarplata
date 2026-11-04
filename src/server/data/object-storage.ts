/** Расширения хранения встроенных объектов. Подключаются платформой, а не конфигурацией. */
import type { Effect } from 'effect';
import type { Database, ReadonlyDatabase } from '../database/database.effect.js';
type RecordValue = Record<string, unknown>;

/** Общий конвейер проверяет поля и политики до вызова адаптера и журналирует публичный результат. */
export interface ObjectStorage {
    /** Совместимые представления существующих таблиц для общих логических запросов. */
    readonly schema: readonly import('../database/sql.builder.js').SqlQuery[];
    readonly standardActions: readonly string[];
    save(guid: string, input: RecordValue, creating: boolean): Effect.Effect<RecordValue, unknown, Database>;
    /** Из входа действия в журнал попадают только явно разрешённые сведения. */
    journalChanges?(name: string, input: RecordValue): import('../journal/descriptions.js').JournalChanges | null;
    /** Чтение служебных таблиц не получает возможности записи. */
    callFunction?(name: string, input: RecordValue): Effect.Effect<unknown, unknown, ReadonlyDatabase> | undefined;
    /** Доверенные обработчики платформы меняют служебные таблицы в общей транзакции. */
    action?(name: string, input: RecordValue): Effect.Effect<unknown, unknown, Database> | undefined;
}
