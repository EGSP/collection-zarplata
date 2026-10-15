/**
 * Объявление формы новой продажи с раскладкой формы существующей продажи. Компонент лежит
 * в соседнем файле `sale-new.object-form-component.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму новой записи; форма существующей продажи объявлена отдельно. */
export const SaleNew = defineObjectForm({ object: Objects.document.sale, kind: 'new' });
