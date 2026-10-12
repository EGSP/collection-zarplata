/**
 * Регистр «Поступления денег»: оплаты проведённых продаж по сменам и способам оплаты. Продажа
 * записывает движение на каждую строку своих оплат. Итог по смене и способу показывает, сколько
 * денег смена приняла этим способом.
 *
 * «Куда оплачено» в измерения не входит: итоги нужны по смене и способу, а приёмник читается
 * из строки оплаты документа. Возврат движений не записывает: способ возврата денег покупателю
 * в правилах магазина не определён.
 */
import { register } from '../../server/metadata/index.js';
import { Shift } from '../documents/shift.document.js';
import { paymentMethods } from '../payments.js';

/** Ограничений итога нет: соответствие оплат сумме продажи проверяет политика продажи. */
export const MoneyReceipts = register('moneyReceipts')
    .title('Поступления денег')
    .dimension('shift', (field) => field.reference(Shift).title('Смена').required())
    .dimension('method', (field) => field.string().title('Способ').choices(paymentMethods).required())
    .resource('amount', (field) => field.money().title('Сумма').required());
