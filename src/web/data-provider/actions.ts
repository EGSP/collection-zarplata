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
import { resourceName, type PerformTarget } from './perform';

/**
 * Возвращает функцию, которая помечает устаревшими все сохранённые ответы сервера о данных.
 * Открытые списки и ссылки перечитываются сразу, остальные при следующем открытии. Сбрасываются
 * ответы обо всех объектах, а не только об изменённом: проведение документа меняет строки
 * регистров, а собственное действие может изменить любые записи. Описания объектов
 * не затрагиваются: от действий над данными они не зависят.
 */
function useInvalidateData(): () => Promise<void> {
    const queryClient = useQueryClient();
    return useCallback(() => queryClient.invalidateQueries({ queryKey: keys().data().get() }), [queryClient]);
}

/**
 * Действие, которое выполняет `useAction`. `Action` — имена действий объекта: у ссылки на объект
 * конфигурации это его стандартные и собственные действия, у описания с сервера любая строка.
 */
export interface ActionCall<Action extends string = string> {
    /** Объект конфигурации, которому принадлежит действие: ссылка на объект либо его описание `ObjectView`. */
    readonly object: PerformTarget & { readonly '~action'?: Action };
    /** Имя действия: стандартное (`save`, `post`, `markDeleted`) или собственное действие объекта. */
    readonly action: NoInfer<Action>;
    /** Входные данные действия. Без них действие получает пустой объект. */
    readonly payload?: object;
    /** Заголовок уведомления об успехе. */
    readonly successMessage: string;
    /** Заголовок уведомления об отказе. Описанием уведомления служит текст сервера. */
    readonly failureMessage?: string;
}

/**
 * Возвращает функцию, которая выполняет действие единого эндпоинта и отдаёт его результат.
 * Об успехе и об отказе сервера пользователю сообщает уведомление; отказ к тому же завершает
 * вызов ошибкой `ApiError`. После успеха сохранённые ответы сервера сбрасываются.
 *
 * Для кода вне платформы это единственный способ изменить данные: так уведомления и сброс
 * сохранённых ответов не зависят от того, какой экран выполнил действие.
 *
 * Имя действия выводится из объекта и идёт первым параметром типа, поэтому тип результата
 * вызывающий код задаёт типом переменной, а не параметром: явный параметр отключил бы вывод
 * имён действий, и опечатка в имени перестала бы быть ошибкой компиляции.
 */
export function useAction(): <Action extends string = string, Result = unknown>(call: ActionCall<Action>) => Promise<Result> {
    const { mutateAsync } = useCustomMutation<BaseRecord, ApiError>();
    const invalidateData = useInvalidateData();
    return useCallback(
        async <Action extends string = string, Result = unknown>({ object, action, payload = {}, successMessage, failureMessage }: ActionCall<Action>) => {
            const response = await mutateAsync({
                url: `${resourceName(object)}/${action}`,
                method: 'post',
                values: payload,
                successNotification: { type: 'success', message: successMessage },
                ...(failureMessage === undefined ? {} : { errorNotification: (error) => ({ type: 'error', message: failureMessage, description: error?.message ?? '' }) }),
            });
            void invalidateData();
            return response.data as Result;
        },
        [mutateAsync, invalidateData],
    );
}
