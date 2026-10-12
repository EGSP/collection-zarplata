/**
 * Объявление элемента на месте части «Оплаты» формы продажи. Компонент лежит в соседнем файле
 * `sale-payments.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SalePayments = defineFormComponent({
    name: 'salePayments',
    override: { object: Objects.document.sale, tablePart: 'payments' },
});
