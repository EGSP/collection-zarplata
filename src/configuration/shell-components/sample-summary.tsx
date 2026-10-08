import { Alert } from 'antd';
import { useListControls, useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Пробный блок: проверяет доступ до чтения данных и управляет действиями списка. */
export default function SampleSummary() {
    const object = useObjectView(Objects.informationRegister.sample);
    return object === undefined ? null : <AvailableSummary />;
}

/** Чтение монтируется только при доступном описании объекта. */
function AvailableSummary() {
    const list = useRecordList(Objects.informationRegister.sample);
    useListControls({ hideCreate: true, hiddenRowActions: ['markDeleted', 'unmarkDeleted'] });
    return <Alert type={list.error === null ? 'info' : 'error'} title="Пробные сведения" description={list.error?.message ?? `Записей: ${list.total}`} />;
}
