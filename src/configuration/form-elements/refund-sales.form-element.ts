/**
 * Объявление элемента формы возврата: показывает товары продаж-оснований и добавляет выбранный
 * товар в возврат. Компонент лежит в соседнем файле `refund-sales.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const RefundSales = defineFormComponent({
    name: 'refundSales',
    insert: { object: Objects.document.refund, group: 'На основании', after: 'bases' },
});
