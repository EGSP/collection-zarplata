/**
 * У купона появился вид: «Процент» или «Сумма» (раздел «Правила учёта», подраздел «Купон»).
 * Все купоны, созданные раньше, процентные, поэтому миграция добавляет колонку `kind` и заполняет
 * её значением «Процент». Колонку добавляет сама миграция, а не синхронизация: синхронизация
 * выполняется после миграций, и заполнить вид было бы нечем.
 *
 * Процент стал необязательным: у купона вида «Сумма» он пуст. Колонка `catalog_coupons.percentage`
 * создана с NOT NULL, а SQLite не умеет снимать ограничение с существующей колонки. Поэтому значения
 * переносятся во временную колонку, прежняя колонка пересоздаётся без ограничения, и значения
 * возвращаются, как в миграции `20261109_sale_payment_mode_optional`.
 *
 * В базе без таблицы купонов миграция ничего не меняет: таблицу создаёт сверка структуры уже
 * с новыми колонками. Колонка процента пересоздаётся, даже если снимок уже считает её
 * необязательной, по той же причине, что в миграции способа оплаты продажи: база разработки,
 * открытая сборкой ветки до миграции, могла записать новый снимок при старом ограничении.
 */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

const table = 'catalog_coupons';
const kind = 'kind';
const percentage = 'percentage';
const temporary = 'percentage_migration';

export const couponKind: SchemaMigration = {
    id: '20261111_coupon_kind',
    part: 'configuration',
    version: '1.3.0',
    changes: [],
    statements: [],
    prepare(previous) {
        const coupons = previous.tables.find((candidate) => candidate.name === table);
        const stored = coupons?.columns.find((candidate) => candidate.name === percentage);
        if (coupons === undefined || stored === undefined) return { changes: [], statements: [] };
        const name = sqlIdentifier(table);
        const current = sqlIdentifier(percentage);
        const copy = sqlIdentifier(temporary);
        // Вид заполняется только при первом запуске: повторно колонку добавлять нельзя.
        const kindStatements = coupons.columns.some((candidate) => candidate.name === kind) ? [] : [
            `ALTER TABLE ${name} ADD COLUMN ${sqlIdentifier(kind)} TEXT`,
            `UPDATE ${name} SET ${sqlIdentifier(kind)} = 'Процент'`,
        ];
        return {
            changes: stored.required ? [`${table}.${percentage}: снять обязательность`] : [],
            statements: [
                ...kindStatements,
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
