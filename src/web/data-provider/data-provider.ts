/**
 * Data provider Refine поверх единого эндпоинта.
 *
 * Refine обращается к ресурсам набором стандартных методов, а сервер выполняет действия над
 * объектами конфигурации. Провайдер только переводит одно в другое:
 *
 * | Метод Refine | Действие сервера |
 * |---|---|
 * | `getList` | `list`; условия отбора с текстом поиска и поиска по представлению становятся входными параметрами `search` и `presentation` |
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
import type { ReferencePresentations } from '../../server/ui/reference-presentation';

/** Наибольший размер страницы, который принимает действие `list`. */
const maximumPageSize = 500;

/**
 * Способы сравнения сервера и соответствующие им операторы отбора Refine. Таблица перечисляет
 * все способы сервера: новый способ в формате описаний не соберётся, пока его нет здесь.
 */
const crudOperators: { readonly [Operator in FilterOperator]: LogicalFilter['operator'] } = {
    equals: 'eq',
    notEquals: 'ne',
    greater: 'gt',
    greaterOrEqual: 'gte',
    less: 'lt',
    lessOrEqual: 'lte',
    contains: 'contains',
};

const filterOperators = new Map<string, FilterOperator>(Object.entries(crudOperators).map(([operator, crudOperator]) => [crudOperator, operator as FilterOperator]));

/** Условие отбора в формате действия `list`: поле, способ сравнения сервера и значение в формате сервера. */
export interface ListCondition {
    readonly field: string;
    readonly operator: FilterOperator;
    readonly value: unknown;
}

/**
 * Имя поля, под которым текст поиска лежит в отборе Refine. Refine хранит в адресе страницы только
 * сортировку, отбор и страницу, поэтому поиск записывается условием отбора и попадает в адрес
 * вместе с ним. У настоящего поля такого имени быть не может: имена полей состоят из букв и цифр.
 */
const searchField = '$search';

/** Условие отбора Refine с текстом поиска. Пустой текст условия не даёт. */
export function searchFilters(search: string): Array<CrudFilter> {
    return search === '' ? [] : [{ field: searchField, operator: 'contains', value: search }];
}

function isSearchFilter(filter: CrudFilter): boolean {
    return 'field' in filter && filter.field === searchField;
}

/**
 * Имя поля, под которым в отборе Refine лежит текст поиска по представлению записи. Сервер
 * принимает его отдельным параметром `presentation`, а не условием: представление не является
 * полем записи, а у справочника с представлением по ссылке хранится в другом объекте.
 */
const presentationField = '$presentation';

/** Условие отбора Refine с текстом поиска по представлению записи. Пустой текст условия не даёт. */
export function presentationFilters(text: string): Array<CrudFilter> {
    return text === '' ? [] : [{ field: presentationField, operator: 'contains', value: text }];
}

function isPresentationFilter(filter: CrudFilter): boolean {
    return 'field' in filter && filter.field === presentationField;
}

/** Текст поиска из отбора Refine. Без условия поиска возвращает пустую строку. */
export function searchOf(filters: ReadonlyArray<CrudFilter>): string {
    const filter = filters.find(isSearchFilter);
    return filter === undefined ? '' : String(filter.value);
}

/** Отбор Refine без условия поиска. */
export function withoutSearch(filters: ReadonlyArray<CrudFilter>): Array<CrudFilter> {
    return filters.filter((filter) => !isSearchFilter(filter));
}

interface ListPage<Item> {
    readonly items: ReadonlyArray<Item>;
    readonly total: number;
    readonly presentations: ReferencePresentations;
}

/**
 * Переводит отбор Refine в условия действия `list`. Сервер соединяет условия через «и», поэтому
 * группа `and` раскрывается в общий список, а группу `or` выразить нечем. Оператор, которому
 * у сервера нет соответствия, завершается ошибкой: молча пропущенное условие показало бы
 * пользователю лишние записи.
 */
export function listConditions(filters: ReadonlyArray<CrudFilter>): Array<ListCondition> {
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

/** Сортировка действия `list` по сортировке Refine. */
export function listOrder({ field, order }: CrudSort): ListSort {
    return { field, direction: order === 'asc' ? 'ascending' : 'descending' };
}

/**
 * Переводит условия действия `list` в отбор Refine. Сравнение с `null` записывается операторами
 * `null` и `nnull`: условие со значением `null` Refine из отбора убирает.
 */
export function crudFilters(conditions: ReadonlyArray<ListCondition>): Array<CrudFilter> {
    return conditions.map(({ field, operator, value }): CrudFilter => {
        if (value === null && operator === 'equals') return { field, operator: 'null', value: true };
        if (value === null && operator === 'notEquals') return { field, operator: 'nnull', value: true };
        return { field, operator: crudOperators[operator], value };
    });
}

/** Сортировка Refine по сортировке из описания списка. */
export function crudSort({ field, direction }: ListSort): CrudSort {
    return { field, order: direction === 'ascending' ? 'asc' : 'desc' };
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
    getList: async <Item extends BaseRecord>({ resource, pagination, filters = [], sorters = [] }: GetListParams): Promise<GetListResponse<Item>> => {
        const target = resourceTarget(resource);
        const search = searchOf(filters);
        const presentation = filters.find(isPresentationFilter);
        const selection = {
            filter: listConditions(withoutSearch(filters).filter((filter) => !isPresentationFilter(filter))),
            sort: sorters.map(listOrder),
            ...(search === '' ? {} : { search }),
            ...(presentation === undefined ? {} : { presentation: String(presentation.value) }),
        };
        const list = (page: number | undefined, pageSize: number | undefined) =>
            perform<ListPage<Item>>({ target, action: 'list', payload: { ...selection, page, pageSize } });

        if (pagination?.mode === 'client' || pagination?.mode === 'off') {
            const items: Array<Item> = [];
            const presentations: Record<string, string | null> = {};
            for (let page = 1; ; page++) {
                const chunk = await list(page, maximumPageSize);
                items.push(...chunk.items);
                Object.assign(presentations, chunk.presentations);
                if (chunk.items.length === 0 || items.length >= chunk.total) return { data: items, total: items.length, presentations };
            }
        }
        const page = await list(pagination?.currentPage, pagination?.pageSize);
        return { data: [...page.items], total: page.total, presentations: page.presentations };
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
