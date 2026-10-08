import { Button } from 'antd';
import { Link, useParams } from 'react-router';
import { NotFoundPage } from '../common/not-found';
import { newRecordSegment } from '../common/paths';
import { objectPath, useObjectView } from '../sdk';
import { ExistingRecordForm } from './existing-record-form';
import { RecordForm } from './record-form';

/**
 * Страница вкладки с формой записи: `/вид/имя/new` открывает форму новой записи, `/вид/имя/<guid>`
 * открывает форму существующей. У записи есть собственный адрес, потому что на неё ведут ссылки
 * из списков, из строк регистров и из других форм.
 *
 * Страница только разбирает адрес: саму форму и чтение записи она берёт готовыми, и они от адреса
 * не зависят.
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
    if (guid !== newRecordSegment) {
        return (
            <ExistingRecordForm
                key={key}
                object={object}
                view={object.form}
                guid={guid}
                failureAction={
                    <Link to={objectPath(object)}>
                        <Button type="primary">Вернуться в список</Button>
                    </Link>
                }
            />
        );
    }
    if (!object.form.actions.some((action) => action.name === 'save')) return <NotFoundPage />;
    return <RecordForm key={key} object={object} view={object.form} record={null} reload={null} />;
}
