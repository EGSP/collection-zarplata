/**
 * Объявление формы нового возврата с раскладкой общей с формой существующего возврата. Компонент лежит
 * в соседнем файле `refund-new.object-form-component.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму новой записи; форма существующего возврата объявлена отдельно. */
export const RefundNew = defineObjectForm({ object: Objects.document.refund, kind: 'new' });
