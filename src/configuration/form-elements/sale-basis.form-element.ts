/**
 * Объявление элемента формы продажи, который показывает отвес-основание ссылкой. Компонент лежит
 * в соседнем файле `sale-basis.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SaleBasis = defineFormComponent({
    name: 'saleBasis',
    insert: { object: Objects.document.sale, group: 'Продажа', after: 'shift' },
});
