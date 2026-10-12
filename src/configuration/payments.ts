/**
 * Оплаты: общая табличная часть документов, которые принимают деньги покупателя. Колонки объявлены
 * один раз, поэтому движения, отчёты и правила читают оплаты разных документов одинаково.
 */
import { tablePart } from '../server/metadata/index.js';
import { PaymentReceivers } from './catalogs/payment-receivers.catalog.js';

/** Оплата наличными: способ оплаты новой продажи. */
export const cash = 'Наличные';

/** Способы одной оплаты. Регистр «Поступления денег» собирает суммы по этим же значениям. */
export const paymentMethods = [cash, 'Безналичные'];

/**
 * Колонки оплаты. «Куда оплачено» хранит приёмника оплат либо произвольный текст: приёмник
 * не всегда заведён в справочнике. Сумма больше нуля: строка без денег оплатой не является.
 */
export const Payments = tablePart((part) => part
    .field('method', (field) => field.string().title('Способ').choices(paymentMethods).required())
    .field('amount', (field) => field.money().title('Сумма').minimum(1).required())
    .field('receiver', (field) => field.composite([field.string().maximumLength(200), field.reference(PaymentReceivers)]).title('Куда оплачено')));
