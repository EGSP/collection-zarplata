import { Form } from 'antd';
import { FieldGroup, RecordFormPage, StandardRecordForm, recordFormElements, useRecordForm, type NewFormProperties } from '../../web/sdk';

/**
 * Форма новой смены. Во вкладке менять нечего, и форма возвращает стандартную.
 *
 * В модальном окне смену открывает продавец в начале дня, поэтому окно сводится к дате открытия
 * и кнопкам сотрудников: группы без рамок, а таблица состава не выводится, потому что кнопки
 * задают тот же состав. Номер новой смене назначит запись, поэтому его нет на форме.
 * Запись в этом окне открывает смену, а закрытие окна отменяет открытие: кнопки подписаны так же.
 *
 * Ветвление стоит до `useRecordForm`: стандартная форма подключает контракт с областью окна сама,
 * поэтому собственная раскладка вынесена в отдельный компонент.
 */
export default function ShiftNewForm(properties: NewFormProperties) {
    if (properties.presentation === 'page') return <StandardRecordForm {...properties} />;
    return <ShiftOpeningDialog {...properties} />;
}

/**
 * Раскладка окна: элементы всех групп формы одним блоком без рамки, кроме таблицы состава.
 *
 * Состояние смены (`ShiftState`) у новой смены ничего не выводит, но скрывает на форме действия,
 * которые политика смены отклоняет. Поэтому оно монтируется в скрытом блоке: в общем блоке его
 * пустое место в раскладке отделяло бы дату от кнопок сотрудников.
 */
function ShiftOpeningDialog(properties: NewFormProperties) {
    const state = useRecordForm(properties);
    const items = state.view.groups.flatMap((group) => group.elements).filter((item) => item !== 'employees');
    const isState = (item: (typeof items)[number]) => typeof item !== 'string' && item.element === 'shiftState';
    return (
        <RecordFormPage state={state} titles={{ actions: { save: 'Открыть' }, close: 'Отменить' }}>
            <FieldGroup elements={recordFormElements(state, items.filter((item) => !isState(item)))} record={state.record} disabled={!state.editable} traversal={state.traversal} />
            <div hidden>
                <FieldGroup elements={recordFormElements(state, items.filter(isState))} />
            </div>
            {/* Форма Ant Design при записи отдаёт значения только выведенных полей. Без скрытого поля
                состав, набранный кнопками, не попал бы в запись. */}
            <Form.Item name="employees" hidden />
        </RecordFormPage>
    );
}
