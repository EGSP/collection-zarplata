/**
 * Описания объектов и перечень страниц конфигурации с сервера (`GET /api/metadata`).
 *
 * По описаниям клиент строит ресурсы Refine, формы и списки, по перечню страниц открывает
 * собственные экраны конфигурации, а по схеме оболочки из того же ответа — список подсистем. Сервер отдаёт только объекты и действия, доступные вошедшему
 * пользователю, поэтому описания принадлежат сессии: без неё не загружаются, а при её завершении
 * сбрасываются.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useSelector } from '@tanstack/react-store';
import type { MetadataResponse, ObjectView } from '../../server/ui/descriptions';
import { sessionStatus } from '../authentication/session';
import { request } from '../common/api';
import type { PerformTarget } from './perform';

/**
 * Запрос описаний в TanStack Query. Описания меняются только с перезапуском сервера и со сменой
 * пользователя, поэтому сами не устаревают: повторно они загружаются после сброса запроса.
 */
export const metadataQuery = queryOptions({
    queryKey: ['metadata'],
    queryFn: () => request<MetadataResponse>({ url: '/metadata' }),
    staleTime: Infinity,
});

/** Описания объектов, доступных пользователю. Пока сессия завершена, запрос к серверу не отправляется. */
export function useMetadata() {
    const status = useSelector(sessionStatus);
    return useQuery({ ...metadataQuery, enabled: status !== 'ended' });
}

/** Описание объекта среди загруженных описаний. Объекта нет, если он не входит в конфигурацию или недоступен пользователю. */
export function findObjectView(metadata: MetadataResponse | undefined, target: PerformTarget | null): ObjectView | undefined {
    if (target === null) return undefined;
    return metadata?.objects.find((object) => object.kind === target.kind && object.name === target.name);
}

/**
 * Описание объекта по его виду и имени. Возвращает `undefined`, если описания ещё не загружены
 * либо у пользователя нет права читать объект: сервер такие объекты не отдаёт.
 */
export function useObjectView(target: PerformTarget | null): ObjectView | undefined {
    return findObjectView(useMetadata().data, target);
}
