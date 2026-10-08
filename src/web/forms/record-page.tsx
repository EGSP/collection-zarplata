import { Button, Result } from 'antd';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { NotFoundPage } from '../common/not-found';
import { newRecordSegment } from '../common/paths';
import { Pending } from '../common/pending';
import { objectPath, useObjectView, useRecord, useTabTitle, type FormView, type ObjectView, type RecordData } from '../sdk';
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
    const key = `${objectPath(object)}/${guid}`;
    if (guid !== newRecordSegment) return <ExistingRecord key={key} object={object} view={object.form} guid={guid} />;
    if (!object.form.actions.some((action) => action.name === 'save')) return <NotFoundPage />;
    return <RecordForm key={key} object={object} view={object.form} record={null} reload={null} />;
}

/**
 * Читает запись и открывает её форму. Если сервер запись не отдал, на месте формы показывается
 * его сообщение и кнопка возврата в список.
 */
function ExistingRecord({ object, view, guid }: { readonly object: ObjectView; readonly view: FormView; readonly guid: string }) {
    const query = useRecord(object, guid);

    // Форма получает запись один раз и дальше ведёт её состояние сама по ответам на свои действия.
    // Запрос после этих действий перечитывается, но его новые ответы форму не меняют: иначе
    // фоновое обновление стёрло бы значения, которые пользователь вводит. Запись берётся только
    // из свежего ответа: сохранённый ранее ответ мог устареть.
    const [record, setRecord] = useState<RecordData | null>(null);
    // Пока записи нет, представления тоже нет. Дальше заголовок вкладки задаёт форма.
    useTabTitle(record === null ? object.title : null);
    if (record === null && query.record !== undefined && !query.loading) setRecord(query.record);

    if (record !== null) return <RecordForm object={object} view={view} record={record} reload={query.reload} />;
    if (query.error !== null && !query.loading) {
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
