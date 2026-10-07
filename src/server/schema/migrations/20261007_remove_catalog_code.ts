/** Удаляет прежний стандартный код из существующих справочников любой конфигурации. */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

/**
 * Снимок задаёт полный набор старых справочников; табличные части исключаются по ключу.
 * Явно объявленный в новой конфигурации код сохраняется. Индексы удаляются раньше
 * колонки: SQLite запрещает DROP COLUMN, пока на колонку ссылается индекс.
 */
export const removeCatalogCode: SchemaMigration = {
    id: '20261007_remove_catalog_code',
    changes: [],
    statements: [],
    prepare(previous, desired) {
        const changes: string[] = [];
        const statements: string[] = [];
        for (const table of previous.tables) {
            const next = desired.tables.find((candidate) => candidate.name === table.name);
            if (!table.name.startsWith('catalog_') || table.primaryKey.length !== 1 || table.primaryKey[0] !== 'guid' ||
                !table.columns.some((column) => column.name === 'code') || next === undefined) continue;
            const removingCode = !next.columns.some((column) => column.name === 'code');
            for (const index of table.indexes.filter((candidate) => candidate.columns.includes('code') &&
                (removingCode || !next.indexes.some((desiredIndex) => desiredIndex.name === candidate.name)))) {
                changes.push(`${table.name}.${index.name}: изменить индекс`);
                statements.push(`DROP INDEX IF EXISTS ${sqlIdentifier(index.name)}`);
            }
            if (removingCode) {
                changes.push(`${table.name}.code: удалить колонку`);
                statements.push(`ALTER TABLE ${sqlIdentifier(table.name)} DROP COLUMN ${sqlIdentifier('code')}`);
            }
        }
        return { changes, statements };
    },
};
