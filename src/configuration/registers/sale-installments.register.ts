/**
 * Регистр «Рассрочки по продажам»: сумма оплаты продажи, которую покупатель вносит в рассрочку,
 * и оформленные на неё рассрочки. Проведённая продажа записывает сумму своих строк оплаты
 * со способом «Рассрочка», проведённая рассрочка по продаже записывает свою сумму с минусом.
 * Итог по продаже равен сумме, на которую рассрочка ещё не оформлена.
 *
 * Положительный итог допустим: продажа проводится раньше, чем оформляется рассрочка.
 */
import { Effect } from 'effect';
import { query } from '../../server/database/sql.builder.js';
import { Database } from '../../server/database/database.effect.js';
import type { DatabaseError } from '../../server/database/database.errors.js';
import { register, type ObjectTarget } from '../../server/metadata/index.js';
import { Sale } from '../documents/sale.document.js';
import { numberAndDate, rubles } from '../money.js';

/**
 * Продажа в тексте отказа: номер и дата, как в её представлении. Тип результата указан явно:
 * действие продажи читает итог этого регистра, и без указания тип регистра выводился бы через
 * тип продажи и обратно.
 */
const saleTitle = (guid: string): Effect.Effect<string, DatabaseError, Database> => Effect.gen(function* () {
    const database = yield* Database;
    const sale = yield* database.get(query(Sale).select({
        columns: ['number', 'date'],
        where: [{ column: 'guid', operator: '=', value: guid }],
        limit: 1,
    }));
    return sale === undefined ? 'продаже, которой нет в базе,' : `продаже ${numberAndDate(sale)}`;
});

/**
 * Ограничение `coverage` связывает сумму рассрочек со строками оплаты (раздел «Правила учёта»):
 * итог по продаже не уходит в минус. Связь выражена ограничением, а не политикой, потому что
 * действует в обе стороны: рассрочку нельзя провести на сумму больше строк «Рассрочка», а продажу
 * нельзя изменить или отменить так, чтобы оформленные рассрочки превысили эти строки.
 */
export const SaleInstallments = register('saleInstallments')
    .title('Рассрочки по продажам')
    // Продажа записывает движения в этот регистр, поэтому файлы импортируют друг друга по кругу.
    // Тип результата указан явно: иначе тип регистра выводился бы через тип продажи и обратно.
    .dimension('sale', (field) => field.reference((): ObjectTarget => Sale).title('Продажа').required())
    .resource('amount', (field) => field.money().title('Сумма').required())
    .constraint('coverage', (constraint) => constraint
        .by(['sale'])
        .minimum('amount', 0)
        .message(({ dimensions, totals }) => Effect.map(saleTitle(dimensions.sale), (title) =>
            `Рассрочки по ${title} превышают сумму её проведённых оплат способом «Рассрочка» на ${rubles(-totals.amount)}`)));
