/**
 * Объявление элемента формы рассрочки: показывает её состояние, принимает взнос, закрывает
 * рассрочку и управляет доступностью формы. Компонент лежит в соседнем файле
 * `installment-state.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const InstallmentState = defineFormComponent({
    name: 'installmentState',
    insert: { object: Objects.document.installment, group: 'Рассрочка', after: 'person' },
});
