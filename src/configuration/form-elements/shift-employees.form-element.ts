/**
 * Объявление элемента формы смены для набора состава: ФИО всех сотрудников, нажатие на которые
 * добавляет сотрудника в состав и убирает из него. Компонент лежит в соседнем файле
 * `shift-employees.form-element-component.tsx`.
 */
import { formElement } from '../../server/metadata/form-elements.js';

export const ShiftEmployees = formElement('shiftEmployees');
