import { useOne } from '@refinedev/core';
import { Button, Result } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import type { FormView, ObjectView } from '../../server/ui/descriptions';
import type { ApiError } from '../common/api';
import { NotFoundPage } from '../common/not-found';
import { newRecordSegment, objectPath } from '../common/paths';
import { Pending } from '../common/pending';
import { useObjectView } from '../data-provider/metadata';
import { resourceName } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import { useTabTitle } from '../tabs/window-tabs';
import { RecordForm } from './record-form';

/**
 * Страница вкладки с формой записи: `/вид/имя/new` открывает форму новой записи, `/вид/имя/<guid>`
 * открывает форму существующей. У записи есть собственный адрес, потому что на неё ведут ссылки
 * из списков, из строк регистров и из других форм.
 *
 * У регистра формы нет, поэтому его адреса форм показывают страницу «не найдено». Так же
 * отвечает адрес новой записи, если у пользователя нет права записи.
 */
export function RecordPage() {
    const { kind, name, guid } = useParams();
    const object = useObjectView(kind === undefined || name === undefined ? null : { kind, name });
    if (object === undefined || object.form === null || guid === undefined) return <NotFoundPage />;
    // После записи новой формы вкладка получает адрес существующей записи. Ключ пересоздаёт форму:
    // существующую запись она читает с сервера, а действия над ней перечитывают её тем же запросом.
    const key = `${resourceName(object)}/${guid}`;
    if (guid !== newRecordSegment) return <ExistingRecord key={key} object={object} view={object.form} guid={guid} />;
    if (!object.form.actions.some((action) => action.name === 'save')) return <NotFoundPage />;
    return <RecordForm key={key} object={object} view={object.form} record={null} reload={null} />;
}

/**
 * Читает запись и открывает её форму. Если сервер запись не отдал, на месте формы показывается
 * его сообщение и кнопка возврата в список.
 */
function ExistingRecord({ object, view, guid }: { readonly object: ObjectView; readonly view: FormView; readonly guid: string }) {
    const { query } = useOne<RecordData, ApiError>({
        resource: resourceName(object),
        id: guid,
        // Об ошибке сообщает сама страница, уведомление её только повторило бы.
        errorNotification: false,
    });

    // Форма получает запись один раз и дальше ведёт её состояние сама по ответам на свои действия.
    // Запрос после этих действий перечитывается, но его новые ответы форму не меняют: иначе
    // фоновое обновление стёрло бы значения, которые пользователь вводит. Запись берётся только
    // из свежего ответа: сохранённый ранее ответ мог устареть.
    const [record, setRecord] = useState<RecordData | null>(null);
    // Пока записи нет, представления тоже нет. Дальше заголовок вкладки задаёт форма.
    useTabTitle(record === null ? object.title : null);
    if (record === null && query.isSuccess && !query.isFetching && !query.isPlaceholderData) setRecord(query.data.data);

    if (record !== null) {
        const reload = async () => {
            const { data, error } = await query.refetch();
            if (data === undefined) throw error ?? new Error('Не удалось прочитать запись');
            return data.data;
        };
        return <RecordForm object={object} view={view} record={record} reload={reload} />;
    }
    if (query.isError && !query.isFetching) {
        return (
            <Result
                status="warning"
                title="Не удалось открыть запись"
                subTitle={query.error.message}
                extra={
                    <Link to={objectPath(object)}>
                        <Button type="primary">Вернуться в список</Button>
                    </Link>
                }
            />
        );
    }
    return <Pending />;
}
