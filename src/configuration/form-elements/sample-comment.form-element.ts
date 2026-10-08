/**
 * Объявление пробного поля ввода комментария: по нему проверяется собственный элемент на месте
 * поля ввода, пока прикладных элементов нет. Компонент лежит в соседнем файле
 * `sample-comment.form-element-component.tsx`. Удаляется вместе с пробными объектами.
 */
import { formElement } from '../../server/metadata/form-elements.js';

export const SampleComment = formElement('sampleComment');
