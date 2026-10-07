import { Typography } from 'antd';
import { Link } from 'react-router';
import type { ObjectTarget, ObjectView } from '../../server/ui/descriptions';
import { recordPath } from '../common/paths';
import { useObjectView } from '../data-provider/metadata';
import type { DisplayProperties, FieldValues } from '../widgets/widget';
import { useReferencePresentation } from './presentation';

/** Текст на месте ссылки, целевой объект которой пользователь читать не вправе. */
export const noAccessText = 'Нет доступа';

/** Отображение ссылки: представление записи, которое открывает её форму. */
export function ReferenceDisplay({ field, value }: DisplayProperties<FieldValues['reference']>) {
    if (value === null || value === undefined) return null;
    return <RecordLink target={field.target} guid={value} />;
}

/** Отображение регистратора строки регистра: представление документа, которое открывает его форму. */
export function RecorderDisplay({ value }: DisplayProperties<FieldValues['recorder']>) {
    if (value === null || value === undefined) return null;
    return <RecordLink target={{ kind: 'document', name: value.document }} guid={value.guid} />;
}

/**
 * Ссылка на форму записи. Если целевого объекта нет в описаниях, сервер не дал пользователю права
 * его читать: запись тогда не запрашивается, а на её месте написано «Нет доступа».
 */
function RecordLink({ target, guid }: { readonly target: ObjectTarget | null; readonly guid: string }) {
    const object = useObjectView(target);
    if (object === undefined) return <Typography.Text type="secondary">{noAccessText}</Typography.Text>;
    return <AccessibleRecordLink object={object} guid={guid} />;
}

function AccessibleRecordLink({ object, guid }: { readonly object: ObjectView; readonly guid: string }) {
    const presentation = useReferencePresentation(object, guid);
    if (!presentation.loaded) return <Typography.Text type="secondary">{presentation.text}</Typography.Text>;
    return <Link to={recordPath(object, guid)}>{presentation.text}</Link>;
}
