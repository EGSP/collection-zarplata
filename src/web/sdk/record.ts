import { useOne } from '@refinedev/core';
import { useCallback } from 'react';
import type { ApiError } from '../common/api';
import { resourceName, type PerformTarget } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';

/** Запись справочника или документа, прочитанная по `guid`, и состояние её чтения. */
export interface RecordQuery {
    /**
     * Запись в том виде, в каком её отдал сервер, вместе со строками табличных частей. Пока запись
     * не прочитана или последнее чтение завершилось отказом, `undefined`. После действия над
     * данными запись перечитывается; до ответа здесь остаётся прежняя, а `loading` равен `true`.
     */
    readonly record: RecordData | undefined;
    readonly loading: boolean;
    /** Отказ сервера в последнем чтении: записи нет либо нет права её читать. */
    readonly error: ApiError | null;
    /** Читает запись заново и возвращает её. Отказ сервера завершает вызов ошибкой. */
    readonly reload: () => Promise<RecordData>;
}

/**
 * Читает запись объекта по `guid`. Об отказе сервера уведомление не показывается: о нём сообщает
 * сам экран на месте записи, уведомление его только повторило бы. При `guid`, равном `null`,
 * запрос не отправляется.
 */
export function useRecord(object: PerformTarget, guid: string | null): RecordQuery {
    const { query } = useOne<RecordData, ApiError>({
        resource: resourceName(object),
        id: guid ?? '',
        queryOptions: { enabled: guid !== null },
        errorNotification: false,
    });
    const { refetch } = query;
    const reload = useCallback(async () => {
        const { data, error } = await refetch();
        if (data === undefined) throw error ?? new Error('Не удалось прочитать запись');
        return data.data;
    }, [refetch]);
    return {
        // Общая настройка клиента запросов оставляет на экране прежние данные, пока идёт запрос.
        // При смене `guid` это была бы другая запись.
        record: query.isPlaceholderData || query.isError ? undefined : query.data?.data,
        loading: query.isFetching,
        error: query.isError ? query.error : null,
        reload,
    };
}
