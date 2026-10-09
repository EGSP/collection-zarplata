import { useEffect, useRef } from 'react';
import { useFormData, useFormValue, useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Подставляет открытую смену в поле «Смена» нового документа. Элемент ничего не выводит и подходит
 * форме любого документа с таким полем, поэтому ссылки на объект формы у него нет.
 *
 * Открытой считается смена без даты закрытия; политика смены допускает не больше одной такой.
 * Смена подставляется один раз и только в пустое поле: выбор пользователя элемент не заменяет.
 * Существующий документ свою смену уже хранит, и для него смены не читаются.
 */
export default function OpenShift() {
    const form = useFormData();
    const shifts = useObjectView(Objects.document.shift);
    // Без права читать смены подставлять нечего, а чтение списка завершилось бы отказом.
    return form.saved !== null || shifts === undefined ? null : <NewDocumentShift />;
}

/** Чтение открытой смены монтируется только на форме нового документа. */
function NewDocumentShift() {
    const form = useFormData();
    const shift = useFormValue(form.object, 'shift');
    const list = useRecordList(Objects.document.shift, { permanentFilter: [{ field: 'closedAt', operator: 'equals', value: null }], pageSize: 1 });
    const open = list.records[0]?.guid ?? null;
    const filled = useRef(false);
    useEffect(() => {
        // Пока элементы формы не сообщили ограничения, форма недоступна и значение не примет.
        if (filled.current || open === null || form.readOnly) return;
        filled.current = true;
        if (shift === null) form.setValue('shift', open);
    }, [open, form.readOnly]);
    return null;
}
