/**
 * Объявление элемента формы рассрочки: показывает её состояние, принимает взнос, закрывает
 * рассрочку и управляет доступностью формы. Компонент лежит в соседнем файле
 * `installment-state.form-element-component.tsx`.
 */
import { formElement } from '../../server/metadata/form-elements.js';

export const InstallmentState = formElement('installmentState');
