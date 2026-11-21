/** Приёмники оплат: куда поступают деньги покупателя, например касса или счёт. */
import { catalog } from '../../server/metadata/index.js';
import { paymentMethods } from '../payment-methods.js';

/**
 * Записи справочника выбирают в полях «Куда оплачено» и «Откуда выдано».
 * Необязательный способ определяет подстановку на формах оплат. Небольшая форма создания
 * остаётся в окне поверх списка.
 */
export const PaymentReceivers = catalog('paymentReceivers')
    .title('Приёмники оплат')
    .field('paymentMethod', (field) => field.string().title('Способ оплаты').choices(paymentMethods))
    .form((form) => form.creation('dialog'));
