/**
 * Объявление пробного поля ввода комментария: по нему проверяется собственный элемент на месте
 * поля ввода, пока прикладных элементов нет. Компонент лежит в соседнем файле
 * `sample-comment.form-element-component.tsx`. Удаляется вместе с пробными объектами.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SampleComment = defineFormComponent({
    name: 'sampleComment',
    override: { object: Objects.document.sample, field: 'comment' },
});
