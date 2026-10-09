/**
 * Объявление элемента формы смены, который показывает её состояние и управляет формой: закрытую
 * смену нельзя изменить, а действия, которые политика смены отклоняет, на форме скрыты.
 * Компонент лежит в соседнем файле `shift-state.form-element-component.tsx`.
 */
import { formElement } from '../../server/metadata/form-elements.js';

export const ShiftState = formElement('shiftState');
