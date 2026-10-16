/**
 * Переименовывает три регистра: названия путали. Данные движений сохраняются: таблицы
 * переименовываются, а индексы пересоздаются под новые имена.
 *
 * | Было                   | Стало                    |
 * |------------------------|--------------------------|
 * | `sales`                | `salesNetOfReturns`      |
 * | `customerSettlements`  | `installmentDebts`       |
 * | `saleInstallments`     | `unarrangedInstallments` |
 *
 * Прочие объекты на регистры не ссылаются: права и роли описаны в конфигурации, журнал регистры не ведёт.
 * В базе без этих таблиц миграция ничего не меняет.
 */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

/** Регистры: прежнее и новое имя. */
const renames = [
    { from: 'sales', to: 'salesNetOfReturns' },
    { from: 'customerSettlements', to: 'installmentDebts' },
    { from: 'saleInstallments', to: 'unarrangedInstallments' },
] as const;

export const renameRegisters: SchemaMigration = {
    id: '20261016_rename_registers',
    changes: [],
    statements: [],
    prepare(previous, desired) {
        const changes: string[] = [];
        const statements: string[] = [];
        for (const { from, to } of renames) {
            const oldTable = previous.tables.find((candidate) => candidate.name === `register_${from}`);
            const newTable = desired.tables.find((candidate) => candidate.name === `register_${to}`);
            if (oldTable === undefined || newTable === undefined) continue;
            statements.push(`ALTER TABLE ${sqlIdentifier(oldTable.name)} RENAME TO ${sqlIdentifier(newTable.name)}`);
            // Индексы остаются под старыми именами: их пересоздают с именами и колонками новой структуры.
            for (const index of oldTable.indexes) statements.push(`DROP INDEX IF EXISTS ${sqlIdentifier(index.name)}`);
            for (const index of newTable.indexes) {
                statements.push(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${sqlIdentifier(index.name)} ON ${sqlIdentifier(newTable.name)} (${index.columns.map(sqlIdentifier).join(', ')})`);
            }
            changes.push(`${oldTable.name}: удалить таблицу`);
        }
        return { changes, statements };
    },
};
