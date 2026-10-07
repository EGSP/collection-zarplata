import { useList } from '@refinedev/core';
import { Empty, Result, Typography } from 'antd';
import { Navigate, useParams } from 'react-router';
import type { ObjectView } from '../../server/ui/descriptions';
import { useMetadata } from '../data-provider/metadata';
import { resourceName } from '../data-provider/perform';
import { objectPath } from './resources';

/** Начальная страница: открывает первый доступный объект. У пользователя без прав объектов нет. */
export function StartPage() {
    const first = useMetadata().data?.objects[0];
    if (first === undefined) return <Empty description="Нет доступных объектов" />;
    return <Navigate to={objectPath(first)} replace />;
}

/**
 * Страница объекта конфигурации по адресу `/вид/имя`. Объект ищется среди описаний, которые
 * сервер отдал пользователю: объект, которого нет в конфигурации, и объект без права чтения
 * для клиента неразличимы.
 */
export function ObjectPage() {
    const { kind, name } = useParams();
    const object = useMetadata().data?.objects.find((candidate) => candidate.kind === kind && candidate.name === name);
    if (object === undefined) return <NotFoundPage />;
    // Ключ пересоздаёт содержимое при смене объекта: иначе до ответа сервера оставались бы данные прежнего.
    return <ObjectSummary key={resourceName(object)} object={object} />;
}

/** Заготовка: список и форму объекта отрисуют рендереры (#14). Пока страница показывает число записей. */
function ObjectSummary({ object }: { readonly object: ObjectView }) {
    const { result, query } = useList({ resource: resourceName(object), pagination: { pageSize: 1 } });
    return (
        <>
            <Typography.Title level={3}>{object.title}</Typography.Title>
            {query.isSuccess && <Typography.Text type="secondary">Записей: {result.total}</Typography.Text>}
        </>
    );
}

export function NotFoundPage() {
    return <Result status="404" title="Страница не найдена" subTitle="Объекта нет в конфигурации, или он вам недоступен." />;
}
