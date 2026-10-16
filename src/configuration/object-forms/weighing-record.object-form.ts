/**
 * Объявление формы существующего отвеса: шапка и товары в одном контейнере. Компонент лежит
 * в соседнем файле `weighing-record.object-form-component.tsx`, раскладка общая с формой
 * нового отвеса в `weighing-form-layout.tsx`.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет форму существующей записи; форма нового отвеса объявлена отдельно. */
export const WeighingRecord = defineObjectForm({ object: Objects.document.weighing, kind: 'record' });
