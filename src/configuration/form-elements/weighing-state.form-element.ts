/**
 * Объявление элемента формы отвеса: показывает его состояние и оформляет продажу выбранных
 * товаров. Компонент лежит в соседнем файле `weighing-state.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const WeighingState = defineFormComponent({
    name: 'weighingState',
    insert: { object: Objects.document.weighing, group: 'Отвес', after: 'person' },
});
