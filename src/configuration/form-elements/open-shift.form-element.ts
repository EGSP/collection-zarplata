/**
 * Объявление элемента формы, который подставляет в новый документ открытую смену. Подходит форме
 * любого документа с полем «Смена». Компонент лежит в соседнем файле
 * `open-shift.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const OpenShift = defineFormComponent({
    name: 'openShift',
    attachments: [
        { insert: { object: Objects.document.sale, group: 'Продажа', after: 'shift' } },
        { insert: { object: Objects.document.refund, group: 'Возврат', after: 'shift' } },
        { insert: { object: Objects.document.weighing, group: 'Отвес', after: 'person' } },
        { insert: { object: Objects.document.installment, group: 'Рассрочка', after: 'person' } },
    ],
});
