/**
 * Объявление поля «Способ оплаты» на форме продажи. Компонент лежит в соседнем файле
 * `sale-payment-mode.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SalePaymentMode = defineFormComponent({
    name: 'salePaymentMode',
    override: { object: Objects.document.sale, field: 'paymentMode' },
});
