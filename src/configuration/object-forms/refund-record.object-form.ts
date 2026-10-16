/**
 * Объявление формы существующего возврата: раскладка общая с формой нового возврата в
 * `refund-form-layout.tsx`. Компонент лежит в соседнем файле `refund-record.object-form-component.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму существующей записи; форма нового возврата объявлена отдельно. */
export const RefundRecord = defineObjectForm({ object: Objects.document.refund, kind: 'record' });
