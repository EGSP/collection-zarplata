import { useOne } from '@refinedev/core';
import { useCallback } from 'react';
import type { ApiError } from '../common/api';
import { resourceName } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import type { ReadObject } from './object-reference';

/** Запись справочника или документа типа `Record`, прочитанная по `guid`, и состояние её чтения. */
export interface RecordQuery<Record = RecordData> {
    /**
     * Запись в том виде, в каком её отдал сервер, вместе со строками табличных частей. Пока запись
     * не прочитана или последнее чтение завершилось отказом, `undefined`. После действия над
     * данными запись перечитывается; до ответа здесь остаётся прежняя, а `loading` равен `true`.
     */
    readonly record: Record | undefined;
    readonly loading: boolean;
    /** Отказ сервера в последнем чтении: записи нет либо нет права её читать. */
    readonly error: ApiError | null;
    /** Читает запись заново и возвращает её. Отказ сервера завершает вызов ошибкой. */
    readonly reload: () => Promise<Record>;
}

/**
 * Читает запись объекта по `guid`. Об отказе сервера уведомление не показывается: о нём сообщает
 * сам экран на месте записи, уведомление его только повторило бы. При `guid`, равном `null`,
 * запрос не отправляется. По ссылке на объект конфигурации запись получает точный тип.
 */
export function useRecord<Record extends RecordData = RecordData>(object: ReadObject<Record>, guid: string | null): RecordQuery<Record> {
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
        return data.data as Record;
    }, [refetch]);
    return {
        // Общая настройка клиента запросов оставляет на экране прежние данные, пока идёт запрос.
        // При смене `guid` это была бы другая запись.
        // Сервер отдаёт запись по описанию объекта, из билдера которого выведен тип `Record`.
        record: query.isPlaceholderData || query.isError ? undefined : (query.data?.data as Record | undefined),
        loading: query.isFetching,
        error: query.isError ? query.error : null,
        reload,
    };
}
