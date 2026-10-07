import { Empty } from 'antd';
import { Navigate, useParams } from 'react-router';
import { NotFoundPage } from '../common/not-found';
import { objectPath } from '../common/paths';
import { useMetadata, useObjectView } from '../data-provider/metadata';
import { resourceName } from '../data-provider/perform';
import { ObjectList } from '../lists/object-list';

/** Начальная страница: открывает первый доступный объект. У пользователя без прав объектов нет. */
export function StartPage() {
    const first = useMetadata().data?.objects[0];
    if (first === undefined) return <Empty description="Нет доступных объектов" />;
    return <Navigate to={objectPath(first)} replace />;
}

/**
 * Страница объекта конфигурации по адресу `/вид/имя`: его список. Объект ищется среди описаний,
 * которые сервер отдал пользователю: объект, которого нет в конфигурации, и объект без права
 * чтения для клиента неразличимы.
 */
export function ObjectPage() {
    const { kind, name } = useParams();
    const object = useObjectView(kind === undefined || name === undefined ? null : { kind, name });
    if (object === undefined) return <NotFoundPage />;
    // Ключ пересоздаёт список при смене объекта: иначе до ответа сервера оставались бы данные прежнего.
    return <ObjectList key={resourceName(object)} object={object} />;
}
