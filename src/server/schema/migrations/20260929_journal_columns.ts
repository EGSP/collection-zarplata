import type { SchemaMigration } from './index.js';

/**
 * Приводит служебную таблицу журнала к колонкам контекста действия и изменённых полей.
 * До этой миграции журнал не заполнялся, поэтому таблица удаляется без переноса строк,
 * а новую вместе с индексами создаёт синхронизация структуры. `IF EXISTS` нужен новой базе:
 * на ней миграция выполняется до создания таблиц.
 */
export const journalColumns: SchemaMigration = {
    id: '20260929_journal_columns',
    part: 'platform',
    version: '1.0.0',
    changes: [
        'platform_journal.actorGuid: удалить колонку',
        'platform_journal.objectKind: удалить колонку',
        'platform_journal.objectName: удалить колонку',
        'platform_journal.objectGuid: удалить колонку',
        'platform_journal.details: удалить колонку',
        'platform_journal.idx_platform_journal_object: изменить индекс',
    ],
    statements: ['DROP TABLE IF EXISTS platform_journal'],
};
