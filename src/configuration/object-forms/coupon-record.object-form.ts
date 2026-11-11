/**
 * Объявление формы существующего купона: поле размера скидки показывается по виду купона.
 * Компонент лежит в соседнем файле `coupon-record.object-form-component.tsx`, раскладка общая
 * с формой нового купона в `coupon-form-layout.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму существующей записи; форма нового купона объявлена отдельно. */
export const CouponRecord = defineObjectForm({ object: Objects.catalog.coupons, kind: 'record' });
