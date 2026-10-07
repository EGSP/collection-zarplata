/**
 * Описания объектов конфигурации с сервера (`GET /api/metadata`).
 *
 * По описаниям клиент строит ресурсы Refine, меню, а также формы и списки. Сервер отдаёт только
 * объекты и действия, доступные вошедшему пользователю, поэтому описания принадлежат сессии:
 * без неё не загружаются, а при её завершении сбрасываются.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import { useSelector } from '@tanstack/react-store';
import type { MetadataResponse } from '../../server/ui/descriptions';
import { sessionStatus } from '../authentication/session';
import { request } from '../common/api';

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
