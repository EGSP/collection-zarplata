/**
 * Объявление элемента форм рассрочки и рассрочки по продаже: показывает состояние, принимает
 * взнос, закрывает рассрочку и управляет доступностью формы. Компонент лежит в соседнем файле
 * `installment-state.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const InstallmentState = defineFormComponent({
    name: 'installmentState',
    attachments: [
        { insert: { object: Objects.document.installment, group: 'Рассрочка', after: 'person' } },
        { insert: { object: Objects.document.saleInstallment, group: 'Рассрочка', after: 'person' } },
    ],
});
