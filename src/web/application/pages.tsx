import { Empty } from 'antd';
import { useParams } from 'react-router';
import { NotFoundPage } from '../common/not-found';
import { useMetadata, useObjectView } from '../data-provider/metadata';
import { ObjectList } from '../lists/object-list';

/**
 * Главный экран: открывается после входа и по адресу `/`. Экран пуст, объекты пользователь
 * открывает из окон подсистем. У пользователя без прав подсистем нет, и экран объясняет,
 * почему открывать нечего.
 */
export function HomePage() {
    const subsystems = useMetadata().data?.shell.subsystems ?? [];
    return subsystems.length === 0 ? <Empty description="Нет доступных объектов" /> : null;
}

/**
 * Страница вкладки по адресу `/вид/имя`: список объекта конфигурации. Объект ищется среди описаний,
 * которые сервер отдал пользователю: объект, которого нет в конфигурации, и объект без права
 * чтения для клиента неразличимы.
 */
export function ObjectPage() {
    const { kind, name } = useParams();
    const object = useObjectView(kind === undefined || name === undefined ? null : { kind, name });
    if (object === undefined) return <NotFoundPage />;
    return <ObjectList object={object} />;
}
