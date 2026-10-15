/**
 * Объявление формы нового отвеса с раскладкой формы существующего отвеса. Компонент лежит
 * в соседнем файле `weighing-new.object-form-component.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму новой записи; форма существующего отвеса объявлена отдельно. */
export const WeighingNew = defineObjectForm({ object: Objects.document.weighing, kind: 'new' });
