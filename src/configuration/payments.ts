/**
 * Оплаты: общая табличная часть документов, которые принимают деньги покупателя. Колонки объявлены
 * один раз, поэтому движения, отчёты и правила читают оплаты разных документов одинаково.
 */
import { Effect } from 'effect';
import { DataValidationError } from '../server/data/data.errors.js';
import { ReadonlyDatabase } from '../server/database/database.effect.js';
import { query } from '../server/database/sql.builder.js';
import { compositeReference } from '../server/metadata/composite.js';
import { tablePart, type FieldFactory } from '../server/metadata/index.js';
import { PaymentReceivers } from './catalogs/payment-receivers.catalog.js';
import { paymentMethods } from './payment-methods.js';
export { cash, paymentMethods } from './payment-methods.js';

/**
 * Способ строки оплаты продажи, при котором деньги не приняты: на сумму строки оформляется
 * рассрочка по продаже, и деньги придут её взносами.
 */
export const installmentMethod = 'Рассрочка';

/**
 * Способ строки расчёта возврата, при котором деньги не выдаются: возврат гасит долг по собственной
 * рассрочке продажи. Назван по результату для покупателя, а не по способу оплаты продажи: продавцу
 * важно, что долг стал меньше.
 */
export const debtSettlement = 'В счёт долга';

/**
 * Способ строки расчёта возврата, при котором деньги не выдаются: возврат пополняет сертификат,
 * которым была оплачена продажа. Назван по результату для покупателя, как «В счёт долга».
 */
export const certificateRefill = 'На сертификат';

/**
 * Составной тип сохраняет старые текстовые оплаты и название автоматически рассчитанного банка.
 * Политики записи требуют у новых и изменённых пользовательских оплат ссылку на приёмник.
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

/** Строка денежного расчёта с видом операции и полем приёмника. */
interface ReceivedPayment {
    readonly method: string;
    readonly receiver?: unknown;
}

/**
 * Сопоставляет строки как мультимножества. Прежняя оплата сохраняется при перестановке строк,
 * а вторая такая же строка проверяется как новая, если раньше была только одна.
 */
function changedPaymentIndexes<Payment>(existing: ReadonlyArray<Payment>, proposed: ReadonlyArray<Payment>, key: (payment: Payment) => string): number[] {
    const remaining = existing.map(key);
    return proposed.flatMap((payment, index) => {
        const found = remaining.indexOf(key(payment));
        if (found !== -1) {
            remaining.splice(found, 1);
            return [];
        }
        return [index];
    });
}

/** Находит изменённые денежные строки без обязательного приёмника. */
export function paymentsWithoutReceiver<Payment extends ReceivedPayment>(existing: ReadonlyArray<Payment>, proposed: ReadonlyArray<Payment>, key: (payment: Payment) => string): number[] {
    return changedPaymentIndexes(existing, proposed, key).filter((index) => {
        const payment = proposed[index]!;
        // Деньги не приняты и не выданы: у оплаты «Рассрочка» и у строк возврата «В счёт долга» и «На сертификат» приёмника нет.
        const withoutMoney = payment.method === installmentMethod || payment.method === debtSettlement || payment.method === certificateRefill;
        return !withoutMoney && (payment.receiver ?? null) === null;
    });
}

/** Поле приёмника и путь к нему, чтобы форма могла отметить ошибку записи. */
interface ReceiverFieldValue {
    readonly value: unknown;
    readonly path: string;
}

/** Собирает поля новых и изменённых строк, сохраняя исторические значения в прежних строках. */
export function changedPaymentReceivers<Payment extends { readonly receiver?: unknown }>(existing: ReadonlyArray<Payment>,
    proposed: ReadonlyArray<Payment>, key: (payment: Payment) => string, tablePart: string): ReceiverFieldValue[] {
    return changedPaymentIndexes(existing, proposed, key).map((index) => ({
        value: proposed[index]!.receiver, path: `payload.fields.${tablePart}.${index}.receiver`,
    }));
}

/** При записи пользователь выбирает действующую запись справочника. Пустые поля проверяет документ. */
export const checkPaymentReceiverReferences = Effect.fnUntraced(function* (fields: ReadonlyArray<ReceiverFieldValue>) {
    const filled = fields.filter((field) => field.value != null).map(({ value, path }) => ({ reference: compositeReference(value), path }));
    if (filled.length === 0) return;
    const guids = [...new Set(filled.flatMap(({ reference }) =>
        reference?.kind === PaymentReceivers.kind && reference.name === PaymentReceivers.name ? [reference.guid] : []))];
    const database = yield* ReadonlyDatabase;
    const receivers = guids.length === 0 ? [] : yield* database.all(query(PaymentReceivers).select({
        columns: ['guid'],
        where: [{ column: 'guid', operator: 'IN', value: guids }, { column: 'deletedAt', operator: '=', value: null }],
    }));
    const available = new Set(receivers.map(({ guid }) => guid));
    const invalid = filled.filter(({ reference }) =>
        reference?.kind !== PaymentReceivers.kind || reference.name !== PaymentReceivers.name || !available.has(reference.guid));
    if (invalid.length > 0) {
        return yield* new DataValidationError({
            message: 'Выберите приёмник из справочника «Приёмники оплат»',
            fields: invalid.map(({ path }) => path),
        });
    }
});
