/**
 * Объявление пробного элемента, который управляет состоянием формы пробного документа: по нему
 * проверяются ограничения формы из собственного элемента, пока прикладных элементов нет.
 * Компонент лежит в соседнем файле `sample-lock.form-element-component.tsx`. Удаляется вместе
 * с пробными объектами.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SampleLock = defineFormComponent({
    name: 'sampleLock',
    insert: { object: Objects.document.sample, group: 'Основное', after: 'comment' },
});
