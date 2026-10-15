/**
 * Объявление формы существующей продажи: шапка, товары и оплата в одном контейнере. Компонент
 * лежит в соседнем файле `sale-record.object-form-component.tsx`, раскладка общая с формой
 * новой продажи в `sale-form-layout.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму существующей записи; форма новой продажи объявлена отдельно. */
export const SaleRecord = defineObjectForm({ object: Objects.document.sale, kind: 'record' });
