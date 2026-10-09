import { Alert, Button } from 'antd';
import { useObjectView, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Второй пробный блок: показывает порядок раскладки и доступность команды создания из SDK. */
export default function SampleHint() {
    const available = useObjectView(Objects.informationRegister.sample);
    const document = useObjectView(Objects.document.sample);
    const openRecord = useOpenRecord();
    if (available === undefined) return null;
    return <Alert type="info" title="Работа с пробным документом" description={
        document?.form?.actions.some((action) => action.name === 'save') === true
            ? <Button onClick={() => void openRecord(Objects.document.sample, null)}>Открыть новую запись</Button>
            : 'Документы доступны для просмотра'
    } />;
}
