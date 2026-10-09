/**
 * Объявление элемента формы, который подставляет в новый документ открытую смену. Подходит форме
 * любого документа с полем «Смена». Компонент лежит в соседнем файле
 * `open-shift.form-element-component.tsx`.
 */
import { formElement } from '../../server/metadata/form-elements.js';

export const OpenShift = formElement('openShift');
