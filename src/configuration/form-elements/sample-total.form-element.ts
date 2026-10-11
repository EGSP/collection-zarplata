/**
 * Объявление пробного элемента формы «Итого»: по нему проверяется собственный элемент в группе
 * формы, пока прикладных элементов нет. Компонент лежит в соседнем файле
 * `sample-total.form-element-component.tsx`. Удаляется вместе с пробными объектами.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SampleTotal = defineFormComponent({
    name: 'sampleTotal',
    insert: { object: Objects.document.sample, group: 'Строки и итог', after: 'lines' },
});
