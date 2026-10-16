/**
 * Объявление пробной формы новой записи документа «Пробный документ»: по нему проверяется
 * переопределение формы объекта, пока прикладных форм нет. Компонент лежит в соседнем файле
 * `sample-new.object-form-component.tsx`. Удаляется вместе с пробными объектами.
 */
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import { Objects } from '../objects.generated.js';

/** Заменяет только форму новой записи: форма существующей записи и список остаются стандартными. */
export const SampleNew = defineObjectForm({ object: Objects.document.sample, kind: 'new' });
