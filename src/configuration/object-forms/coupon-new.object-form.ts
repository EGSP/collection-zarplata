/**
 * Объявление формы нового купона: поле размера скидки показывается по виду купона. Компонент лежит
 * в соседнем файле `coupon-new.object-form-component.tsx`, раскладка общая с формой существующего
 * купона в `coupon-form-layout.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму новой записи; форма существующего купона объявлена отдельно. */
export const CouponNew = defineObjectForm({ object: Objects.catalog.coupons, kind: 'new' });
