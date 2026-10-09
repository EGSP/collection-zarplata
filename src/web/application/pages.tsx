import { Empty } from 'antd';
import { useState } from 'react';
import { useParams } from 'react-router';
import { NotFoundPage } from '../common/not-found';
import { useMetadata, useObjectView } from '../data-provider/metadata';
import { ObjectList } from '../lists/object-list';
import { ShellGroups } from '../sdk/shell-groups';
import { ShellGroupContent } from '../sdk/shell-group-content';

/**
 * Главный экран: выводит клиентскую группу конфигурации. Сообщение об отсутствии объектов
 * появляется, только если нет ни подсистем, ни фактически выведенных компонентов.
 */
export function HomePage() {
    const subsystems = useMetadata().data?.shell.subsystems ?? [];
    const [hasContent, setHasContent] = useState(false);
    return <>
        <ShellGroupContent group={ShellGroups.home} onContent={setHasContent} />
        {subsystems.length === 0 && !hasContent && <Empty description="Нет доступных объектов" />}
    </>;
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
