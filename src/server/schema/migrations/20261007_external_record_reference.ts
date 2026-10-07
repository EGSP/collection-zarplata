/** Преобразует прежние поля внешней связи в общую ссылку без изменения внешнего ключа. */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

/** Переносит имя справочника и guid в JSON-ссылку до удаления прежних колонок. */
export const externalRecordReference: SchemaMigration = {
    id: '20261007_external_record_reference',
    changes: [],
    statements: [],
    prepare(previous) {
        const table = previous.tables.find((candidate) => candidate.name === 'informationRegister_externalLinks');
        if (table === undefined || !table.columns.some((column) => column.name === 'targetObject') ||
            !table.columns.some((column) => column.name === 'recordGuid')) return { changes: [], statements: [] };
        const name = sqlIdentifier(table.name);
        const removed = ['targetObject', 'recordGuid'];
        const indexes = table.indexes.filter((index) => index.columns.some((column) => removed.includes(column)));
        return {
            changes: [
                ...removed.map((column) => `${table.name}.${column}: удалить колонку`),
                ...indexes.map((index) => `${table.name}.${index.name}: изменить индекс`),
            ],
            statements: [
                `ALTER TABLE ${name} ADD COLUMN ${sqlIdentifier('record')} TEXT`,
                `UPDATE ${name} SET ${sqlIdentifier('record')} = json_object('kind', 'catalog', 'name', ${sqlIdentifier('targetObject')}, 'guid', ${sqlIdentifier('recordGuid')})`,
                ...indexes.map((index) => `DROP INDEX IF EXISTS ${sqlIdentifier(index.name)}`),
                ...removed.map((column) => `ALTER TABLE ${name} DROP COLUMN ${sqlIdentifier(column)}`),
            ],
        };
    },
};
