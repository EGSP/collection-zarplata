import { Typography } from 'antd';
import { RecordTablePart, useFormData, useFormValue } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { RecordOf } from '../../server/metadata/index';
import type { SampleDocument } from '../documents/sample.document';

/** Пример просмотра через SDK: нажатие копирует строку в форму без изменения исходного документа. */
export default function SampleRows() {
    const form = useFormData(Objects.document.sampleSelection);
    const source = useFormValue(Objects.document.sampleSelection, 'source');
    if (source === null) return <Typography.Text type="secondary">Выберите документ-источник</Typography.Text>;
    return <RecordTablePart object={Objects.document.sample} guid={source} part="lines" onRowClick={(row) => {
        const line = row as RecordOf<typeof SampleDocument>['lines'][number];
        form.setValue('lines', (current) => [...current, { ...line, note: null }]);
    }} />;
}
