/**
 * Остаток рассрочки по продаже стал итогом регистра «Долги по рассрочкам» (`MoneyFieldBuilder.total`):
 * поле больше не хранится, его значение считает чтение. Прежняя колонка с формулой
 * `сумма − взносы` удаляется: в ней не было бы погашений возвратами, а данные регистр уже содержит.
 */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

export const installmentBalanceTotal: SchemaMigration = {
    id: '20261102_installment_balance_total',
    part: 'configuration',
    version: '1.1.0',
    changes: ['document_saleInstallment.balance: удалить колонку'],
    statements: [`ALTER TABLE ${sqlIdentifier('document_saleInstallment')} DROP COLUMN ${sqlIdentifier('balance')}`],
};
