import { Result } from 'antd';
import { useState, type ReactNode } from 'react';
import { Pending } from '../common/pending';
import { useRecord, useWindowTitle, type FormView, type ObjectView, type RecordData } from '../sdk';
import { RecordForm } from './record-form';

interface ExistingRecordFormProperties {
    readonly object: ObjectView;
    readonly view: FormView;
    readonly guid: string;
    /**
     * Что предложить пользователю, если сервер запись не отдал: вкладка предлагает вернуться
     * в список. Выход зависит от того, где показана форма, поэтому его задаёт вызывающий код.
     */
    readonly failureAction?: ReactNode;
}

/**
 * Читает существующую запись и открывает её форму. Пока запись читается, показывает признак
 * ожидания; если сервер запись не отдал, на месте формы показывает его сообщение.
 *
 * Компонент не зависит от адреса и вкладки: заголовок он сообщает ближайшей области окна,
 * поэтому им пользуется форма, показанная в любой области.
 */
export function ExistingRecordForm({ object, view, guid, failureAction }: ExistingRecordFormProperties) {
    const query = useRecord(object, guid);

    // Форма получает запись один раз и дальше ведёт её состояние сама по ответам на свои действия.
    // Запрос после этих действий перечитывается, но его новые ответы форму не меняют: иначе
    // фоновое обновление стёрло бы значения, которые пользователь вводит. Запись берётся только
    // из свежего ответа: сохранённый ранее ответ мог устареть.
    const [record, setRecord] = useState<RecordData | null>(null);
    // Пока записи нет, представления тоже нет. Дальше заголовок области задаёт форма.
    useWindowTitle(record === null ? object.title : null);
    if (record === null && query.record !== undefined && !query.loading) setRecord(query.record);

    if (record !== null) return <RecordForm object={object} view={view} record={record} reload={query.reload} />;
    if (query.error !== null && !query.loading) {
        return <Result status="warning" title="Не удалось открыть запись" subTitle={query.error.message} extra={failureAction} />;
    }
    return <Pending />;
}
