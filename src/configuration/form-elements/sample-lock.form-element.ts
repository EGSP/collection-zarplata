/**
 * Объявление пробного элемента, который управляет состоянием формы пробного документа: по нему
 * проверяются ограничения формы из собственного элемента, пока прикладных элементов нет.
 * Компонент лежит в соседнем файле `sample-lock.form-element-component.tsx`. Удаляется вместе
 * с пробными объектами.
 */
import { formElement } from '../../server/metadata/form-elements.js';

export const SampleLock = formElement('sampleLock');
