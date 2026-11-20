import type { SchemaMigration } from './index.js';

/** Заполняет итог из сохранённых строк расчётов до открытия списка в новой версии. */
export const refundSettlementTotal: SchemaMigration = {
    id: '20261120_refund_settlement_total',
    part: 'configuration',
    version: '1.4.0',
    changes: [],
    statements: [],
    prepare(previous) {
        const refunds = previous.tables.find((table) => table.name === 'document_refund');
        // В пустой базе таблицу создаст синхронизация после выполнения миграций.
        if (refunds === undefined) return { changes: [], statements: [] };

        const statements = refunds.columns.some((column) => column.name === 'settlementTotal') ? [] : [
            'ALTER TABLE document_refund ADD COLUMN settlementTotal INTEGER',
        ];
        // Если база старше табличной части, у её возвратов нет строк расчётов.
        const total = previous.tables.some((table) => table.name === 'document_refund_settlements')
            ? 'COALESCE((SELECT SUM(amount) FROM document_refund_settlements WHERE ownerGuid = document_refund.guid), 0)'
            : '0';
        statements.push(`UPDATE document_refund SET settlementTotal = ${total}`);
        return { changes: [], statements };
    },
};
