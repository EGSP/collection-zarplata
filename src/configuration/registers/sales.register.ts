/**
 * Регистр «Продажи»: суммы продаж и возвратов по продажам и сменам. Продажа записывает свою сумму,
 * возврат записывает суммы своих строк с минусом по каждой продаже. Итог по продаже показывает,
 * сколько по ней ещё можно вернуть, итог по смене показывает её продажи за вычетом возвратов по ним.
 *
 * Смена движения всегда равна смене продажи: возврат, оформленный в другую смену, уменьшает
 * итог смены, которая продала. По итогу смены считается её результат, и возврат должен
 * уменьшать результат тех, кто продал, а не тех, кто принял товар обратно.
 */
import { Effect } from 'effect';
import { query } from '../../server/database/sql.builder.js';
import { Database } from '../../server/database/database.effect.js';
import { register, type ObjectTarget } from '../../server/metadata/index.js';
import { Sale } from '../documents/sale.document.js';
import { Shift } from '../documents/shift.document.js';
import { numberAndDate, rubles } from '../money.js';

/**
 * Ограничение `refundLimit` задаёт предел возврата (раздел «Правила учёта»): итог по продаже
 * не уходит в минус. Оно же запрещает отменить проведение продажи и пометить её на удаление,
 * пока по ней проведены возвраты, и не даёт провести возврат по непроведённой продаже:
 * без движения продажи итог по ней отрицателен.
 */
export const Sales = register('sales')
    .title('Продажи')
    // Продажа записывает движения в этот регистр, поэтому файлы импортируют друг друга по кругу.
    // Тип результата указан явно: иначе тип регистра выводился бы через тип продажи и обратно.
    .dimension('sale', (field) => field.reference((): ObjectTarget => Sale).title('Продажа').required())
    .dimension('shift', (field) => field.reference(Shift).title('Смена').required())
    .resource('amount', (field) => field.money().title('Сумма').required())
    .constraint('refundLimit', (constraint) => constraint
        .by(['sale'])
        .minimum('amount', 0)
        .message(({ dimensions, totals }) => Effect.gen(function* () {
            const database = yield* Database;
            const sale = yield* database.get(query(Sale).select({
                columns: ['number', 'date'],
                where: [{ column: 'guid', operator: '=', value: dimensions.sale }],
                limit: 1,
            }));
            const title = sale === undefined ? 'продаже, которой нет в базе,' : `продаже ${numberAndDate(sale)}`;
            return `Возвраты по ${title} превышают её проведённую сумму на ${rubles(-totals.amount)}`;
        })));
