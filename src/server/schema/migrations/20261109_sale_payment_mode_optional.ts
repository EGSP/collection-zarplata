/**
 * Способ оплаты продажи стал необязательным: продажу, целиком оплаченную сертификатами, записывают
 * без способа оплаты (раздел «Правила учёта», подраздел «Оплата продажи»). Колонка
 * `document_sale.paymentMode` создана с NOT NULL, а SQLite не умеет снимать ограничение
 * с существующей колонки. Поэтому значения переносятся во временную колонку, прежняя колонка
 * удаляется и создаётся заново без ограничения, затем значения возвращаются.
 *
 * Команды строятся, если колонка есть в снимке прежней структуры. Колонка пересоздаётся, даже если
 * снимок уже считает её необязательной: базы разработки, открытые сборкой этой ветки до миграции,
 * записали новый снимок, а ограничение в таблице осталось. В новой базе таблицу продаж создаёт
 * сверка структуры уже без ограничения.
 */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

const table = 'document_sale';
const column = 'paymentMode';
const temporary = 'paymentMode_migration';

export const salePaymentModeOptional: SchemaMigration = {
    id: '20261109_sale_payment_mode_optional',
    part: 'configuration',
    version: '1.2.0',
    changes: [],
    statements: [],
    prepare(previous) {
        const stored = previous.tables.find((candidate) => candidate.name === table)?.columns.find((candidate) => candidate.name === column);
        if (stored === undefined) return { changes: [], statements: [] };
        const name = sqlIdentifier(table);
        const current = sqlIdentifier(column);
        const copy = sqlIdentifier(temporary);
        return {
            changes: stored.required ? [`${table}.${column}: снять обязательность`] : [],
            statements: [
                `ALTER TABLE ${name} ADD COLUMN ${copy} ${stored.type}`,
                `UPDATE ${name} SET ${copy} = ${current}`,
                `ALTER TABLE ${name} DROP COLUMN ${current}`,
                `ALTER TABLE ${name} ADD COLUMN ${current} ${stored.type}`,
                `UPDATE ${name} SET ${current} = ${copy}`,
                `ALTER TABLE ${name} DROP COLUMN ${copy}`,
            ],
        };
    },
};
