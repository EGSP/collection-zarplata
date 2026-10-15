import { Alert } from 'antd';
import { RecordFormLayout, RecordFormPage, StandardRecordForm, useRecordForm, type NewFormProperties } from '../../web/sdk';

/**
 * Пробная форма новой записи «Пробного документа». Служит образцом собственной формы объекта,
 * которая меняет раскладку только в одном месте показа.
 *
 * В модальном окне менять нечего, поэтому форма возвращает стандартную. Во вкладке она выводит
 * подсказку над группами, а поведение, кнопки и каркас берёт из SDK.
 *
 * Ветвление стоит до `useRecordForm`: стандартная форма подключает контракт с областью окна сама,
 * поэтому собственная раскладка вынесена в отдельный компонент.
 */
export default function SampleNewForm(properties: NewFormProperties) {
    if (properties.presentation === 'dialog') return <StandardRecordForm {...properties} />;
    return <SampleNewPage {...properties} />;
}

/** Раскладка вкладки: подсказка и все группы формы. */
function SampleNewPage(properties: NewFormProperties) {
    const state = useRecordForm(properties);
    return (
        <RecordFormPage state={state}>
            <Alert type="info" showIcon title="Строки и оплату можно заполнить и после записи документа" />
            <RecordFormLayout state={state} />
        </RecordFormPage>
    );
}
