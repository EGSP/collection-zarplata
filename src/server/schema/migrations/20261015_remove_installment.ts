/** Удаляет документ «Рассрочка»: его заменила рассрочка по продаже. */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

/** Имя удалённого документа: так он записан в колонке регистратора и в ссылках. */
const document = 'installment';

/** Таблица шапки документа; таблицы его частей начинаются с неё и подчёркивания. */
const table = `document_${document}`;

/**
 * Вместе с таблицами документа удаляются сведения, которые на него ссылаются: иначе остались бы
 * долги и поступления денег без документа, а ссылки вели бы на объект, которого нет в конфигурации.
 *
 * - Движения регистров, записанные документом, ищутся по колонке регистратора.
 * - Полная ссылка хранится JSON-строкой; столбец такой ссылки в снимке не отличается от обычной
 *   строки, поэтому проверяются все текстовые столбцы: строка совпадёт только с JSON-ссылкой
 *   на документ. Необязательная ссылка очищается, а запись с обязательной ссылкой удаляется:
 *   без неё запись не пройдёт проверку.
 * - Ссылочный вариант составного поля хранит цель в столбце `<поле>_target`; при очистке
 *   очищаются все столбцы поля. Обязательное составное поле удаляет запись целиком.
 * - Записи журнала о документе удаляются: журнал показывает объекты по описанию конфигурации.
 *
 * Таблицы частей удаляются раньше таблицы шапки. В базе без документа миграция ничего не меняет.
 */
export const removeInstallment: SchemaMigration = {
    id: '20261015_remove_installment',
    part: 'configuration',
    version: '1.0.0',
    changes: [],
    statements: [],
    prepare(previous, desired) {
        if (!previous.tables.some((candidate) => candidate.name === table)) return { changes: [], statements: [] };
        const removed = previous.tables.filter((candidate) => candidate.name === table || candidate.name.startsWith(`${table}_`));
        const statements: string[] = [];
        for (const remaining of desired.tables) {
            const old = previous.tables.find((candidate) => candidate.name === remaining.name);
            if (old === undefined || old.name.startsWith('platform_')) continue;
            const name = sqlIdentifier(old.name);
            const columns = new Set(old.columns.map((column) => column.name));
            if (columns.has('recorderDocument')) statements.push(`DELETE FROM ${name} WHERE ${sqlIdentifier('recorderDocument')} = '${document}'`);
            for (const column of old.columns) {
                const quoted = sqlIdentifier(column.name);
                if (column.name.endsWith('_target')) {
                    const field = column.name.slice(0, -'_target'.length);
                    const fieldColumns = old.columns.filter((candidate) => candidate.name.startsWith(`${field}_`));
                    const condition = `${quoted} = 'document/${document}'`;
                    if (fieldColumns.some((candidate) => candidate.required)) statements.push(`DELETE FROM ${name} WHERE ${condition}`);
                    else statements.push(`UPDATE ${name} SET ${fieldColumns.map((candidate) => `${sqlIdentifier(candidate.name)} = NULL`).join(', ')} WHERE ${condition}`);
                } else if (column.type === 'TEXT') {
                    // Сравнение вида и имени, а не строки целиком: в JSON-ссылке есть ещё guid.
                    const condition = `json_valid(${quoted}) AND json_extract(${quoted}, '$.kind') = 'document' AND json_extract(${quoted}, '$.name') = '${document}'`;
                    statements.push(column.required ? `DELETE FROM ${name} WHERE ${condition}` : `UPDATE ${name} SET ${quoted} = NULL WHERE ${condition}`);
                }
            }
        }
        statements.push(`DELETE FROM ${sqlIdentifier('platform_journal')} WHERE ${sqlIdentifier('targetKind')} = 'document' AND ${sqlIdentifier('targetName')} = '${document}'`);
        // Части удаляются раньше шапки; порядок в снимке не гарантирован.
        const ordered = [...removed].sort((left, right) => right.name.length - left.name.length);
        statements.push(...ordered.map((candidate) => `DROP TABLE IF EXISTS ${sqlIdentifier(candidate.name)}`));
        return { changes: ordered.map((candidate) => `${candidate.name}: удалить таблицу`), statements };
    },
};
