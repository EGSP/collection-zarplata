/**
 * Router provider Refine для приложения: привязка к React Router с разбором значений отбора.
 *
 * Refine хранит состояние списка (сортировку, отбор, страницу) в строке запроса адреса. Строка
 * запроса не различает типы: число 100 и логическое `true` после разбора возвращаются строками.
 * Сервер строку на месте числа отклоняет, поэтому список, открытый по сохранённому адресу
 * с отбором по числу, не загрузился бы. Здесь значения отбора приводятся к виду поля по описанию
 * списка объекта, которому принадлежит адрес.
 */
import type { CrudFilter, RouterProvider } from '@refinedev/core';
import routerProvider from '@refinedev/react-router';
import { useCallback } from 'react';
import type { ListFilter, MetadataResponse } from '../../server/ui/descriptions';
import { useMetadata } from '../data-provider/metadata';
import { resourceName } from '../data-provider/perform';

/** Возвращает значение отбора в том типе, в котором его ждёт сервер для поля этого вида. */
function typedValue(filter: ListFilter | undefined, value: unknown): unknown {
    if (filter === undefined || typeof value !== 'string') return value;
    if (filter.kind === 'number' || filter.kind === 'money') return Number(value);
    if (filter.kind === 'boolean') return value === 'true';
    return value;
}

function typedFilters(metadata: MetadataResponse | undefined, resource: string | undefined, filters: ReadonlyArray<CrudFilter>): Array<CrudFilter> {
    const object = metadata?.objects.find((candidate) => resourceName(candidate) === resource);
    return filters.map((filter) => {
        // Группы условий список не создаёт, поэтому приводятся только простые условия.
        if (!('field' in filter)) return filter;
        return { ...filter, value: typedValue(object?.list.filters.find((candidate) => candidate.field === filter.field), filter.value) };
    });
}

/** Router provider для `<Refine>`. От привязки Refine отличается только разбором адреса. */
export const applicationRouterProvider: RouterProvider = {
    ...routerProvider,
    parse: () => {
        const parse = routerProvider.parse?.();
        const metadata = useMetadata().data;
        return useCallback(() => {
            const parsed = parse?.() ?? {};
            const filters = parsed.params?.filters;
            if (filters === undefined) return parsed;
            return { ...parsed, params: { ...parsed.params, filters: typedFilters(metadata, parsed.resource?.name, filters) } };
        }, [parse, metadata]);
    },
};
