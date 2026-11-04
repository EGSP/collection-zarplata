/**
 * Выполнение действий над записями из интерфейса и сброс сохранённых ответов сервера после них.
 *
 * Клиент хранит ответы сервера в кеше запросов, чтобы не перечитывать список при возврате
 * из формы и не запрашивать повторно записи по ссылкам. После изменяющего действия эти ответы
 * устаревают, и их нужно сбросить: иначе список показывал бы запись в прежнем состоянии.
 */
import { keys, useCustom, useCustomMutation, type BaseRecord } from '@refinedev/core';
import { keepPreviousData, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import type { ApiError } from '../common/api';
import type { FunctionMap } from '../../server/metadata/builders';
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
    const queryClient = useQueryClient();
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
            if (object.kind === 'platform' && (object.name === 'authorization' || object.name === 'users')) void queryClient.invalidateQueries({ queryKey: ['metadata'] });
            return response.data as Result;
        },
        [mutateAsync, invalidateData, queryClient],
    );
}

/** Чтение результата действия: тот же вызов, но без уведомлений, потому что действие только читает. */
export interface ActionQuery<Action extends string = string> {
    readonly object: PerformTarget & { readonly '~action'?: Action };
    readonly action: NoInfer<Action>;
    readonly payload?: object;
    /** Читать ли результат сейчас. Пока `false`, запрос не отправляется: например, не выбрана продажа. */
    readonly enabled?: boolean;
    /**
     * Перечитывать результат через столько миллисекунд, пока значение не `false`. Нужен, когда
     * сервер меняет данные сам, без действия в клиенте: например, пока идёт резервная копия.
     */
    readonly refreshInterval?: number | false;
}

/** Прочитанный результат действия и его обновление. */
export interface ActionResult<Result> {
    readonly data: Result | undefined;
    readonly loading: boolean;
    /**
     * Читает результат заново. Нужен, когда данные на сервере могли измениться без действия
     * в этом клиенте: например, сервер отклонил запись, потому что другой пользователь изменил данные.
     */
    readonly refresh: () => Promise<void>;
}

/** Вызов функции объекта для `useFunctionResult`. */
export interface FunctionQuery<Functions extends FunctionMap, Name extends keyof Functions & string> {
    /** Объект конфигурации, которому принадлежит функция: ссылка на объект. */
    readonly object: PerformTarget & { readonly '~functions': Functions };
    readonly name: Name;
    /** Входные данные функции; их тип выводится из её объявления. */
    readonly payload: Functions[Name]['input'];
    /** Вызывать ли функцию сейчас. Пока `false`, запрос не отправляется. */
    readonly enabled?: boolean;
    /**
     * Пока читается результат с другими входными данными, отдавать прежний. Нужен постраничным
     * результатам, например ленте продаж: при листании и поиске строки не мигают пустотой. По умолчанию
     * выключен: результат для другой записи нельзя показывать под её именем даже на время загрузки.
     */
    readonly keepPrevious?: boolean;
}

/**
 * Результат функции объекта. Функция только считает, поэтому вызов устроен как чтение: ответ
 * хранится в кеше запросов о данных и перечитывается после любого изменяющего действия.
 * Тип результата выводится из объявления функции. Отказ, например нехватка права, оставляет
 * `data` пустым без уведомления, как у `useActionResult`.
 *
 * ```tsx
 * const figures = useFunctionResult({ object: Objects.document.saleInstallment, name: 'figures', payload: { date: null, installments } });
 * ```
 */
export function useFunctionResult<Functions extends FunctionMap, const Name extends keyof Functions & string>(
    { object, name, payload, enabled = true, keepPrevious = false }: FunctionQuery<Functions, Name>,
): ActionResult<Functions[Name]['output']> {
    const { query } = useCustom<BaseRecord, ApiError>({
        url: `${resourceName(object)}/${name}`,
        method: 'post',
        config: { payload: payload as object },
        meta: { function: true },
        queryOptions: { enabled, ...(keepPrevious ? { placeholderData: keepPreviousData } : {}) },
        errorNotification: false,
    });
    return {
        data: query.data?.data as Functions[Name]['output'] | undefined,
        loading: query.isFetching,
        refresh: async () => {
            await query.refetch();
        },
    };
}

/**
 * Результат собственного действия, которое только читает данные, как запрос с кешем: он обновляется
 * после любого изменяющего действия, потому что сохранённые ответы сервера о данных сбрасываются.
 * Уведомлений нет ни об успехе, ни об отказе: отказ, например нехватка права на действие, оставляет
 * `data` пустым, и экран показывает себя без этих данных. Для изменяющих действий служит `useAction`.
 */
export function useActionResult<Result = unknown, Action extends string = string>({ object, action, payload = {}, enabled = true, refreshInterval = false }: ActionQuery<Action>): ActionResult<Result> {
    const { query } = useCustom<BaseRecord, ApiError>({
        url: `${resourceName(object)}/${action}`,
        method: 'post',
        config: { payload },
        queryOptions: { enabled, refetchInterval: refreshInterval },
        errorNotification: false,
    });
    const result = query.data?.data;
    // Подтверждение исполнения без публичного результата не подставляется вместо данных экрана.
    const concealed = result !== null && typeof result === 'object' && Object.keys(result).length === 1 && result['completed'] === true;
    return {
        data: concealed ? undefined : result as Result | undefined,
        loading: query.isFetching,
        refresh: async () => {
            await query.refetch();
        },
    };
}
