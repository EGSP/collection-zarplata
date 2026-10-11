/**
 * Объявление элемента формы смены для набора состава: ФИО всех сотрудников, нажатие на которые
 * добавляет сотрудника в состав и убирает из него. Компонент лежит в соседнем файле
 * `shift-employees.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const ShiftEmployees = defineFormComponent({
    name: 'shiftEmployees',
    insert: { object: Objects.document.shift, group: 'Сотрудники' },
});
