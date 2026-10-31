/** Переводит взносы рассрочки на общие колонки оплат: способ и «Куда оплачено» вместо получателя. */
import { sqlIdentifier } from '../../database/sql.builder.js';
import type { SchemaMigration } from './index.js';

/** Таблица взносов рассрочки и её прежняя колонка получателя. */
const table = 'document_installment_payments';
const recipient = 'recipient';

/**
 * Получатель был строкой, а «Куда оплачено» составное поле: синхронизация создала бы его столбцы
 * пустыми и потребовала бы миграции на удаление прежней колонки. Поэтому значения переносятся
 * здесь, до удаления: текст получателя становится строковым вариантом «Куда оплачено».
 *
 * Прежние взносы получают способ «Наличные»: способа у них не было, а колонка обязательна,
 * и без значения запись рассрочки не прошла бы проверку. Столбцы ссылочного варианта
 * «Куда оплачено» и его индекс добавляет синхронизация после миграции.
 *
 * В базе без таблицы взносов или без колонки получателя миграция ничего не меняет.
 */
export const installmentPaymentColumns: SchemaMigration = {
    id: '20261012_installment_payment_columns',
    part: 'configuration',
    version: '1.0.0',
    changes: [],
    statements: [],
    prepare(previous) {
        const payments = previous.tables.find((candidate) => candidate.name === table);
        if (payments === undefined || !payments.columns.some((column) => column.name === recipient)) return { changes: [], statements: [] };
        const name = sqlIdentifier(table);
        const old = sqlIdentifier(recipient);
        const method = sqlIdentifier('method');
        const receiverType = sqlIdentifier('receiver_type');
        const receiverText = sqlIdentifier('receiver_text');
        return {
            changes: [`${table}.${recipient}: удалить колонку`],
            statements: [
                `ALTER TABLE ${name} ADD COLUMN ${method} TEXT`,
                `ALTER TABLE ${name} ADD COLUMN ${receiverType} TEXT`,
                `ALTER TABLE ${name} ADD COLUMN ${receiverText} TEXT`,
                `UPDATE ${name} SET ${method} = 'Наличные'`,
                // Получатель из одних пробелов значением не считается: строковый вариант его не принял бы.
                `UPDATE ${name} SET ${receiverType} = 'string', ${receiverText} = ${old} WHERE ${old} IS NOT NULL AND trim(${old}) <> ''`,
                `ALTER TABLE ${name} DROP COLUMN ${old}`,
            ],
        };
    },
};
