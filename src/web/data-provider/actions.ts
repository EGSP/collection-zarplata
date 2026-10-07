/**
 * Выполнение действий над записями из интерфейса и сброс сохранённых ответов сервера после них.
 *
 * Клиент хранит ответы сервера в кеше запросов, чтобы не перечитывать список при возврате
 * из формы и не запрашивать повторно записи по ссылкам. После изменяющего действия эти ответы
 * устаревают, и их нужно сбросить: иначе список показывал бы запись в прежнем состоянии.
 */
import { keys, useCustomMutation, type BaseRecord } from '@refinedev/core';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ApiError } from '../common/api';

/**
 * Возвращает функцию, которая помечает устаревшими все сохранённые ответы сервера о данных.
 * Открытые списки и ссылки перечитываются сразу, остальные при следующем открытии. Сбрасываются
 * ответы обо всех объектах, а не только об изменённом: проведение документа меняет строки
 * регистров, а собственное действие может изменить любые записи. Описания объектов
 * не затрагиваются: от действий над данными они не зависят.
 */
export function useInvalidateData(): () => Promise<void> {
    const queryClient = useQueryClient();
    return useCallback(() => queryClient.invalidateQueries({ queryKey: keys().data().get() }), [queryClient]);
}

/** Действие над ресурсом, которое выполняет `useAction`. */
export interface ActionCall {
    /** Имя ресурса Refine: `document.sample`. */
    readonly resource: string;
    /** Имя действия: стандартное (`post`, `markDeleted`) или собственное действие объекта. */
    readonly action: string;
    readonly payload: object;
    /** Заголовок уведомления об успехе. */
    readonly successMessage: string;
}

/**
 * Возвращает функцию, которая выполняет действие единого эндпоинта и отдаёт его результат.
 * Об успехе и об отказе сервера пользователю сообщает уведомление; отказ к тому же завершает
 * вызов ошибкой `ApiError`. После успеха сохранённые ответы сервера сбрасываются.
 */
export function useAction(): <Result>(call: ActionCall) => Promise<Result> {
    const { mutateAsync } = useCustomMutation<BaseRecord, ApiError>();
    const invalidateData = useInvalidateData();
    return useCallback(
        async <Result>({ resource, action, payload, successMessage }: ActionCall) => {
            const response = await mutateAsync({
                url: `${resource}/${action}`,
                method: 'post',
                values: payload,
                successNotification: { type: 'success', message: successMessage },
            });
            void invalidateData();
            return response.data as Result;
        },
        [mutateAsync, invalidateData],
    );
}
