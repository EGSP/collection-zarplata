/**
 * Объявление элемента формы закрытия периода: форма только для просмотра, а действия страницы
 * «Зарплата» на ней скрыты. Компонент лежит в соседнем файле `period-closing-state.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const PeriodClosingState = defineFormComponent({
    name: 'periodClosingState',
    insert: { object: Objects.document.periodClosing, group: 'Закрытие', after: 'amount' },
});
