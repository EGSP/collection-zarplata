/**
 * Поле сертификата «Физическое лицо» (`person`) заменено составным полем «Держатель» (`holder`):
 * физическое лицо из справочника или ФИО строкой (раздел «Правила учёта», подраздел «Сертификат»).
 *
 * Синхронизация создала бы столбцы держателя пустыми и потребовала бы миграции на удаление
 * прежней колонки, поэтому значения переносятся здесь: физическое лицо каждого сертификата
 * становится ссылочным вариантом держателя. Столбец строкового варианта миграция добавляет
 * вместе с остальными, чтобы все столбцы поля появились одной командой; индекс держателя по его
 * столбцам строит синхронизация после миграции.
 *
 * В базе без таблицы сертификатов или без прежней колонки миграция ничего не меняет.
 */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

const table = 'document_certificate';
const person = 'person';
/** Индекс прежней ссылки: синхронизация строит такие индексы для каждого ссылочного поля. */
const personIndex = `idx_${table}_${person}`;

export const certificateHolder: SchemaMigration = {
    id: '20261111_set_certificate_holder',
    part: 'configuration',
    version: '1.3.0',
    changes: [],
    statements: [],
    prepare(previous) {
        const certificates = previous.tables.find((candidate) => candidate.name === table);
        if (certificates === undefined || !certificates.columns.some((column) => column.name === person)) return { changes: [], statements: [] };
        const name = sqlIdentifier(table);
        const old = sqlIdentifier(person);
        const holderType = sqlIdentifier('holder_type');
        const holderTarget = sqlIdentifier('holder_target');
        const holderGuid = sqlIdentifier('holder_guid');
        const hasIndex = certificates.indexes.some((index) => index.name === personIndex);
        return {
            changes: [`${table}.${person}: удалить колонку`, ...hasIndex ? [`${table}.${personIndex}: изменить индекс`] : []],
            statements: [
                `ALTER TABLE ${name} ADD COLUMN ${holderType} TEXT`,
                `ALTER TABLE ${name} ADD COLUMN ${sqlIdentifier('holder_text')} TEXT`,
                `ALTER TABLE ${name} ADD COLUMN ${holderTarget} TEXT`,
                `ALTER TABLE ${name} ADD COLUMN ${holderGuid} TEXT`,
                // Цель ссылки хранится как `catalog/<имя справочника>`, как её записывает составное поле.
                `UPDATE ${name} SET ${holderType} = 'reference', ${holderTarget} = 'catalog/physicalPersons', ${holderGuid} = ${old} WHERE ${old} IS NOT NULL`,
                // SQLite не удаляет колонку, на которую опирается индекс.
                `DROP INDEX IF EXISTS ${sqlIdentifier(personIndex)}`,
                `ALTER TABLE ${name} DROP COLUMN ${old}`,
            ],
        };
    },
};
