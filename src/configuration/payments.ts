/**
 * Оплаты: общая табличная часть документов, которые принимают деньги покупателя. Колонки объявлены
 * один раз, поэтому движения, отчёты и правила читают оплаты разных документов одинаково.
 */
import { tablePart, type FieldFactory } from '../server/metadata/index.js';
import { PaymentReceivers } from './catalogs/payment-receivers.catalog.js';

/** Оплата наличными: способ оплаты новой продажи. */
export const cash = 'Наличные';

/** Способы, которыми принимаются деньги. Регистр «Поступления денег» собирает суммы по этим же значениям. */
export const paymentMethods = [cash, 'Безналичные'];

/**
 * Способ строки оплаты продажи, при котором деньги не приняты: на сумму строки оформляется
 * рассрочка по продаже, и деньги придут её взносами.
 */
export const installmentMethod = 'Рассрочка';

/**
 * «Куда оплачено»: приёмник оплат либо произвольный текст, потому что приёмник не всегда заведён
 * в справочнике. Объявлено отдельно: то же поле запрашивает действие «Внести» рассрочки.
 */
export const receiverField = (field: FieldFactory) => field.composite([field.string().maximumLength(200), field.reference(PaymentReceivers)]).title('Куда оплачено');

/**
 * Колонки оплаты с заданными способами. Сумма больше нуля: строка без денег оплатой не является.
 *
 * Способы передаёт документ: взнос рассрочки принимается только деньгами, а строка оплаты продажи
 * допускает ещё и способ «Рассрочка».
 */
export const paymentColumns = (methods: ReadonlyArray<string>) => tablePart((part) => part
    .field('method', (field) => field.string().title('Способ').choices(methods).required())
    .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
    .field('receiver', receiverField));

/** Оплата деньгами: колонки взноса рассрочки. */
export const Payments = paymentColumns(paymentMethods);
