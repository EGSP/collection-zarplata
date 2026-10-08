/**
 * Объявление пробного элемента формы «Итого»: по нему проверяется собственный элемент в группе
 * формы, пока прикладных элементов нет. Компонент лежит в соседнем файле
 * `sample-total.form-element-component.tsx`. Удаляется вместе с пробными объектами.
 */
import { formElement } from '../../server/metadata/form-elements.js';

export const SampleTotal = formElement('sampleTotal');
