/**
 * Остаток рассрочки по продаже стал итогом регистра «Долги по рассрочкам» (`MoneyFieldBuilder.total`):
 * поле больше не хранится, его значение считает чтение. Прежняя колонка с формулой
 * `сумма − взносы` удаляется: в ней не было бы погашений возвратами, а данные регистр уже содержит.
 *
 * Колонка удаляется, только если она есть в снимке прежней структуры. В новой базе таблицы
 * рассрочек до миграции ещё нет: её создаёт сверка структуры после миграций, и безусловный
 * `ALTER TABLE` останавливал запуск на чистой базе, например с `--database=memory`.
 */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

const table = 'document_saleInstallment';
const column = 'balance';

export const installmentBalanceTotal: SchemaMigration = {
    id: '20261102_installment_balance_total',
    part: 'configuration',
    version: '1.1.0',
    changes: [],
    statements: [],
    prepare(previous) {
        const stored = previous.tables.find((candidate) => candidate.name === table);
        if (stored === undefined || !stored.columns.some((candidate) => candidate.name === column)) return { changes: [], statements: [] };
        return {
            changes: [`${table}.${column}: удалить колонку`],
            statements: [`ALTER TABLE ${sqlIdentifier(table)} DROP COLUMN ${sqlIdentifier(column)}`],
        };
    },
};
