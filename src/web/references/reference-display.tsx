import { Typography } from 'antd';
import { Link } from 'react-router';
import type { ObjectView } from '../../server/ui/descriptions';
import { recordPath } from '../common/paths';
import { objectReference } from '../../server/metadata/references';
import type { ObjectReferenceValue } from '../../server/metadata/descriptions';
import { useObjectView } from '../data-provider/metadata';
import type { DisplayProperties, FieldValues } from '../widgets/widget';
import { noAccessText, useReferencePresentation } from './presentation';
import { useOpenRecord } from '../sdk/platform/open-record';
import type { ReactNode } from 'react';

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

/** Свойства ссылки на запись. */
export interface RecordLinkProperties {
    /** Полная ссылка: вид и имя объекта и `guid` записи. */
    readonly reference: ObjectReferenceValue;
}

/**
 * Ссылка на форму записи: представление записи, которое открывает её вкладку. Если целевого
 * объекта нет в описаниях, сервер не дал пользователю права его читать: запись тогда
 * не запрашивается, а на её месте написано «Нет доступа».
 */
export function RecordLink({ reference }: RecordLinkProperties) {
    const object = useObjectView(reference);
    if (object === undefined) return <Typography.Text type="secondary">{noAccessText}</Typography.Text>;
    return <AccessibleRecordLink object={object} guid={reference.guid} />;
}

function AccessibleRecordLink({ object, guid }: { readonly object: ObjectView; readonly guid: string }) {
    const presentation = useReferencePresentation(object, guid);
    if (!presentation.loaded) return <Typography.Text type="secondary">{presentation.text}</Typography.Text>;
    return <RecordNavigationLink object={object} guid={guid}>{presentation.text}</RecordNavigationLink>;
}

/** Единый переход для текста ссылки и кнопки рядом с полем, включая составное значение. */
export function RecordNavigationLink({ object, guid, children }: { readonly object: ObjectView; readonly guid: string; readonly children: ReactNode }) {
    const openRecord = useOpenRecord();
    return <Link to={recordPath(object, guid)} onClick={(event) => {
        // Ctrl/Meta и средняя кнопка сохраняют браузерное открытие исходного адреса:
        // правило выполнит маршрут новой вкладки. Shift вместо нового окна выбирает оригинал.
        if (!event.shiftKey && (event.ctrlKey || event.metaKey || event.altKey || event.button !== 0)) return;
        event.preventDefault();
        void openRecord(object, guid, 'tab', { original: event.shiftKey });
    }}>{children}</Link>;
}
