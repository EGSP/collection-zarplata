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

/** Строка оплаты, которую проверяет `paymentsWithoutReceiver`: способ и «Куда оплачено». */
interface ReceivedPayment {
    readonly method: string;
    readonly receiver?: unknown;
}

/**
 * Номера (с нуля) новых и изменённых строк оплаты, у которых не указано «Куда оплачено»
 * (раздел «Правила учёта»). Продавец указывает, куда приняты деньги, поэтому поле обязательно
 * у каждой строки, кроме способа «Рассрочка»: деньги по ней не приняты.
 *
 * Строки прежней записи не проверяются: документ, записанный до этого правила, отменяется
 * и меняется без заполнения старых оплат. Строки сравниваются по `key` как мультимножества:
 * совпавшая с прежней строка считается неизменной, где бы она ни стояла.
 */
export function paymentsWithoutReceiver<Payment extends ReceivedPayment>(existing: ReadonlyArray<Payment>, proposed: ReadonlyArray<Payment>, key: (payment: Payment) => string): number[] {
    const remaining = existing.map(key);
    return proposed.flatMap((payment, index) => {
        const found = remaining.indexOf(key(payment));
        if (found !== -1) {
            remaining.splice(found, 1);
            return [];
        }
        // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
        return payment.method !== installmentMethod && (payment.receiver ?? null) === null ? [index] : [];
    });
}
