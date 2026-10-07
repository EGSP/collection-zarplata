import { Typography } from 'antd';
import { Link } from 'react-router';
import type { ObjectView } from '../../server/ui/descriptions';
import { recordPath } from '../common/paths';
import { objectReference } from '../../server/metadata/references';
import type { ObjectReferenceValue } from '../../server/metadata/descriptions';
import { useObjectView } from '../data-provider/metadata';
import type { DisplayProperties, FieldValues } from '../widgets/widget';
import { useReferencePresentation } from './presentation';

/** Текст на месте ссылки, целевой объект которой пользователь читать не вправе. */
export const noAccessText = 'Нет доступа';

/** Отображение ссылки: представление записи, которое открывает её форму. */
export function ReferenceDisplay({ field, value }: DisplayProperties<FieldValues['reference']>) {
    if (value === null || value === undefined) return null;
    if (field.target === null) return null;
    return <RecordLink reference={objectReference(field.target, value)} />;
}

/** Отображение регистратора строки регистра: представление документа, которое открывает его форму. */
export function RecorderDisplay({ value }: DisplayProperties<FieldValues['recorder']>) {
    if (value === null || value === undefined) return null;
    return <RecordLink reference={objectReference({ kind: 'document', name: value.document }, value.guid)} />;
}

/** Полная ссылка использует то же представление и открытие карточки, что обычная ссылка и регистратор. */
export function ObjectReferenceDisplay({ value }: DisplayProperties<FieldValues['objectReference']>) {
    if (value === null || value === undefined) return null;
    return <RecordLink reference={value} />;
}

/**
 * Ссылка на форму записи. Если целевого объекта нет в описаниях, сервер не дал пользователю права
 * его читать: запись тогда не запрашивается, а на её месте написано «Нет доступа».
 */
function RecordLink({ reference }: { readonly reference: ObjectReferenceValue }) {
    const object = useObjectView(reference);
    if (object === undefined) return <Typography.Text type="secondary">{noAccessText}</Typography.Text>;
    return <AccessibleRecordLink object={object} guid={reference.guid} />;
}

function AccessibleRecordLink({ object, guid }: { readonly object: ObjectView; readonly guid: string }) {
    const presentation = useReferencePresentation(object, guid);
    if (!presentation.loaded) return <Typography.Text type="secondary">{presentation.text}</Typography.Text>;
    return <Link to={recordPath(object, guid)}>{presentation.text}</Link>;
}
