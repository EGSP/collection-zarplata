/**
 * Объявление элемента формы смены, который показывает её состояние и управляет формой: закрытую
 * смену нельзя изменить, а действия, которые политика смены отклоняет, на форме скрыты.
 * Компонент лежит в соседнем файле `shift-state.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const ShiftState = defineFormComponent({
    name: 'shiftState',
    insert: { object: Objects.document.shift, group: 'Смена', after: 'date' },
});
