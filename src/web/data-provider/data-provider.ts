/**
 * Data provider Refine поверх единого эндпоинта.
 *
 * Refine обращается к ресурсам набором стандартных методов, а сервер выполняет действия над
 * объектами конфигурации. Провайдер только переводит одно в другое:
 *
 * | Метод Refine | Действие сервера |
 * |---|---|
 * | `getList` | `list` |
 * | `getOne` | `get` |
 * | `getMany` | пакет действий `get`, общий для всех одновременных вызовов |
 * | `create` | `save` без `guid` |
 * | `update` | `save` с `guid` |
 * | `deleteOne` | `markDeleted`: физически записи не удаляются |
 * | `custom` | любое действие, в том числе собственное |
 *
 * Запись возвращается в том виде, в каком её отдал сервер. Её идентификатор — `guid`: его
 * Refine передаёт в параметре `id`. Поля `id` у записей нет.
 */
import type { BaseRecord, CrudFilter, CrudSort, DataProvider, GetListParams, GetListResponse, GetManyParams, GetManyResponse, LogicalFilter } from '@refinedev/core';
import type { FilterOperator, ListSort } from '../../server/ui/descriptions';
import { apiPath } from '../common/api';
import { perform, resourceTarget } from './perform';
import { loadRecord } from './records';

/** Наибольший размер страницы, который принимает действие `list`. */
const maximumPageSize = 500;

/**
 * Способы сравнения сервера и соответствующие им операторы отбора Refine. Таблица перечисляет
 * все способы сервера: новый способ в формате описаний не соберётся, пока его нет здесь.
 */
export const crudOperators: { readonly [Operator in FilterOperator]: LogicalFilter['operator'] } = {
    equals: 'eq',
    notEquals: 'ne',
    greater: 'gt',
    greaterOrEqual: 'gte',
    less: 'lt',
    lessOrEqual: 'lte',
    contains: 'contains',
};

const filterOperators = new Map<string, FilterOperator>(Object.entries(crudOperators).map(([operator, crudOperator]) => [crudOperator, operator as FilterOperator]));

interface ListCondition {
    readonly field: string;
    readonly operator: FilterOperator;
    readonly value: unknown;
}

interface ListPage<Item> {
    readonly items: ReadonlyArray<Item>;
    readonly total: number;
}

/**
 * Переводит отбор Refine в условия действия `list`. Сервер соединяет условия через «и», поэтому
 * группа `and` раскрывается в общий список, а группу `or` выразить нечем. Оператор, которому
 * у сервера нет соответствия, завершается ошибкой: молча пропущенное условие показало бы
 * пользователю лишние записи.
 */
function listConditions(filters: ReadonlyArray<CrudFilter>): Array<ListCondition> {
    return filters.flatMap((filter): Array<ListCondition> => {
        // Группу условий от условия отличает отсутствие поля.
        if (!('field' in filter)) {
            if (filter.operator === 'or') throw new Error('Сервер не поддерживает отбор по условию «или»');
            return listConditions(filter.value);
        }
        // Заполненность поля сервер проверяет сравнением с null. Сам Refine условие со значением null
        // из отбора таблицы убирает, поэтому для такой проверки у него отдельные операторы.
        if (filter.operator === 'null') return [{ field: filter.field, operator: 'equals', value: null }];
        if (filter.operator === 'nnull') return [{ field: filter.field, operator: 'notEquals', value: null }];
        const operator = filterOperators.get(filter.operator);
        if (operator === undefined) throw new Error(`Сервер не поддерживает способ сравнения «${filter.operator}»`);
        return [{ field: filter.field, operator, value: filter.value }];
    });
}

function listOrder({ field, order }: CrudSort): ListSort {
    return { field, direction: order === 'asc' ? 'ascending' : 'descending' };
}

/** Сортировка Refine по сортировке из описания списка. */
export function crudSort({ field, direction }: ListSort): CrudSort {
    return { field, order: direction === 'ascending' ? 'asc' : 'desc' };
}

/** Способ сравнения сервера по оператору отбора Refine. У оператора без соответствия способа нет. */
export function filterOperator(operator: string): FilterOperator | undefined {
    return filterOperators.get(operator);
}

/** Выполняет действие над ресурсом и возвращает результат в виде ответа Refine. */
async function act<Result>(resource: string, action: string, payload: unknown): Promise<{ data: Result }> {
    return { data: await perform<Result>({ target: resourceTarget(resource), action, payload }) };
}

/**
 * Data provider приложения. Имя ресурса — вид и имя объекта через точку (`catalog.sample`).
 * Методы завершаются `ApiError` с текстом сервера, а при вызове, который серверу передать
 * нельзя (неверное имя ресурса, неподдерживаемый оператор отбора), — обычной ошибкой.
 */
export const dataProvider: DataProvider = {
    getApiUrl: () => apiPath,

    /**
     * Без параметров страницы действуют значения сервера: первая страница по 50 записей.
     * В режимах `client` и `off` Refine ждёт все записи сразу, поэтому они читаются страницами
     * наибольшего размера, пока не будут получены все.
     */
    getList: async <Item extends BaseRecord>({ resource, pagination, filters, sorters }: GetListParams): Promise<GetListResponse<Item>> => {
        const target = resourceTarget(resource);
        const selection = { filter: listConditions(filters ?? []), sort: (sorters ?? []).map(listOrder) };
        const list = (page: number | undefined, pageSize: number | undefined) =>
            perform<ListPage<Item>>({ target, action: 'list', payload: { ...selection, page, pageSize } });

        if (pagination?.mode === 'client' || pagination?.mode === 'off') {
            const items: Array<Item> = [];
            for (let page = 1; ; page++) {
                const chunk = await list(page, maximumPageSize);
                items.push(...chunk.items);
                if (chunk.items.length === 0 || items.length >= chunk.total) return { data: items, total: items.length };
            }
        }
        const page = await list(pagination?.currentPage, pagination?.pageSize);
        return { data: [...page.items], total: page.total };
    },

    getOne: ({ resource, id }) => act(resource, 'get', { guid: id }),

    /**
     * Читает записи по `guid`. Одновременные вызовы, в том числе для разных ресурсов, уходят
     * на сервер одним пакетом: так читаются записи, на которые ведут ссылки открытой страницы.
     */
    getMany: async <Item extends BaseRecord>({ resource, ids }: GetManyParams): Promise<GetManyResponse<Item>> => ({
        data: (await Promise.all(ids.map((id) => loadRecord(resource, String(id))))) as Array<Item>,
    }),

    /** `variables` — значения полей и табличные части записи, как в `payload.fields` действия `save`. */
    create: ({ resource, variables }) => act(resource, 'save', { fields: variables }),

    /** `variables` передаются целиком: `save` заменяет все поля и строки табличных частей записи. */
    update: ({ resource, id, variables }) => act(resource, 'save', { guid: id, fields: variables }),

    /** Помечает запись на удаление и возвращает её с заполненным `deletedAt`. */
    deleteOne: ({ resource, id }) => act(resource, 'markDeleted', { guid: id }),

    /**
     * Выполняет любое действие. `url` — ресурс и действие через косую черту
     * (`document.sample/post`, `platform.journal/history`), `payload` — входные данные действия.
     * Метод HTTP значения не имеет: единый эндпоинт принимает только `POST`.
     */
    custom: async ({ url, payload }) => {
        const separator = url.lastIndexOf('/');
        if (separator < 1 || separator === url.length - 1) {
            throw new Error(`Адрес действия «${url}» должен состоять из ресурса и действия через косую черту, например document.sample/post`);
        }
        return act(url.slice(0, separator), url.slice(separator + 1), payload);
    },
};
