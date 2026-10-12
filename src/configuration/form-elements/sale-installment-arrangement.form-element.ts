/**
 * Объявление элемента формы продажи, который показывает сумму, на которую рассрочка ещё
 * не оформлена, и оформляет рассрочку по продаже. Компонент лежит в соседнем файле
 * `sale-installment-arrangement.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SaleInstallmentArrangement = defineFormComponent({
    name: 'saleInstallmentArrangement',
    insert: { object: Objects.document.sale, group: 'Оплата', after: 'paid' },
});
