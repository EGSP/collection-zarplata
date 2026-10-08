import { Alert } from 'antd';
import { useFormData, useFormRestrictions } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Пробный элемент, который управляет состоянием формы пробного документа: документ с записанным
 * комментарием нельзя изменить и провести с формы. Служит образцом элемента, который задаёт
 * ограничения формы по состоянию записи.
 *
 * Условие берётся из записанного состояния, а не из значения на форме: иначе форма стала бы
 * недоступной при вводе первой буквы комментария, и записать его было бы нельзя. После записи
 * форма меняет состояние сама, без повторного открытия.
 *
 * Это ограничение только интерфейса: действие `post` через единый эндпоинт такой документ
 * по-прежнему проводит. Настоящий запрет задаёт политика записи объекта.
 */
export default function SampleLock() {
    const form = useFormData(Objects.document.sample);
    const locked = (form.saved?.comment ?? null) !== null;
    useFormRestrictions(Objects.document.sample, locked ? { readOnly: true, hiddenActions: ['post'] } : {});
    // Элемент может ничего не выводить: ограничения он объявляет хуком, а не разметкой.
    return locked ? <Alert type="info" showIcon title="Документ с комментарием изменить и провести нельзя" /> : null;
}
