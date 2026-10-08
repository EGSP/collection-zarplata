/**
 * Чтение списка записей объекта: отбор, поиск, сортировка и страница.
 *
 * Хук скрывает от экрана Refine: наружу он отдаёт условия и сортировку в формате действия `list`,
 * тех же типов, что в описании списка. Состояние списка хранит Refine. Текст поиска он хранить
 * не умеет, поэтому поиск записывается в отбор отдельным условием (`searchFilters`), и вместе
 * с отбором попадает в адрес вкладки.
 */
import { useTable } from '@refinedev/core';
import { useCallback, useMemo } from 'react';
import type { ListSort } from '../../server/ui/descriptions';
import type { ReferencePresentations } from '../../server/ui/reference-presentation';
import type { ApiError } from '../common/api';
import { crudFilters, crudSort, listConditions, listOrder, searchFilters, searchOf, withoutSearch, type ListCondition } from '../data-provider/data-provider';
import { resourceName, type PerformTarget } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';

/** Размер страницы списка, если экран не задал свой. */
export const defaultPageSize = 50;

/** Настройки чтения списка. */
export interface RecordListOptions {
    /** Сортировка при открытии; поля перечислены по старшинству. Обычно это `defaultSort` описания списка. */
    readonly sort?: ReadonlyArray<ListSort>;
    /** Размер страницы при открытии. По умолчанию 50 записей. */
    readonly pageSize?: number;
    /**
     * Хранить отбор, поиск, сортировку и страницу в адресе вкладки. Тогда адрес можно сохранить
     * в закладки, а список после перезагрузки страницы открывается в прежнем состоянии. Адрес
     * у вкладки один, поэтому включать настройку можно только у одного списка на экране.
     */
    readonly address?: boolean;
}

/** Страница списка записей и управление её отбором, поиском, сортировкой и номером. */
export interface RecordList {
    /** Записи текущей страницы. Пока загружается другая страница, остаются записи прежней. */
    readonly records: ReadonlyArray<RecordData>;
    /** Число записей, подходящих под отбор и поиск, на всех страницах. */
    readonly total: number;
    /** Представления записей, на которые ссылаются записи страницы. Их использует `RecordTable`. */
    readonly presentations: ReferencePresentations | undefined;
    readonly loading: boolean;
    /** Отказ сервера в последнем чтении. Уведомление о нём уже показано. */
    readonly error: ApiError | null;
    readonly filter: ReadonlyArray<ListCondition>;
    /** Заменяет отбор и возвращает список на первую страницу: в новом отборе прежней страницы может не быть. */
    readonly setFilter: (filter: ReadonlyArray<ListCondition>) => void;
    readonly search: string;
    /** Заменяет текст поиска и возвращает список на первую страницу. Пустая строка поиск отменяет. */
    readonly setSearch: (search: string) => void;
    readonly sort: ReadonlyArray<ListSort>;
    /** Заменяет сортировку и возвращает список на первую страницу. */
    readonly setSort: (sort: ReadonlyArray<ListSort>) => void;
    readonly page: number;
    readonly pageSize: number;
    readonly setPage: (page: number, pageSize?: number) => void;
}

/**
 * Читает страницу списка объекта. Объект должен быть доступен пользователю для чтения: иначе
 * сервер отвечает отказом, и он попадает в `error`.
 */
export function useRecordList(object: PerformTarget, { sort = [], pageSize = defaultPageSize, address = false }: RecordListOptions = {}): RecordList {
    const { tableQuery, result, sorters, setSorters, filters, setFilters, currentPage, setCurrentPage, pageSize: currentPageSize, setPageSize } = useTable<RecordData, ApiError>({
        resource: resourceName(object),
        syncWithLocation: address,
        pagination: { pageSize },
        sorters: { initial: sort.map(crudSort) },
        filters: { defaultBehavior: 'replace' },
    });

    const search = searchOf(filters);
    // Refine отдаёт новые массивы при каждой отрисовке только после изменения, поэтому по ним можно запоминать.
    const filter = useMemo(
        () =>
            withoutSearch(filters).flatMap((condition) => {
                // Условие из адреса, которое сервер не поддерживает, в отбор экрана не входит:
                // об отказе сообщает само чтение списка, а ошибка здесь уронила бы экран.
                try {
                    return listConditions([condition]);
                } catch {
                    return [];
                }
            }),
        [filters],
    );
    const order = useMemo(() => sorters.map(listOrder), [sorters]);

    const setFilter = useCallback(
        (next: ReadonlyArray<ListCondition>) => {
            setFilters([...crudFilters(next), ...searchFilters(search)], 'replace');
            setCurrentPage(1);
        },
        [setFilters, setCurrentPage, search],
    );
    const setSearch = useCallback(
        (next: string) => {
            setFilters([...withoutSearch(filters), ...searchFilters(next)], 'replace');
            setCurrentPage(1);
        },
        [setFilters, setCurrentPage, filters],
    );
    const setSort = useCallback(
        (next: ReadonlyArray<ListSort>) => {
            setSorters(next.map(crudSort));
            setCurrentPage(1);
        },
        [setSorters, setCurrentPage],
    );
    const setPage = useCallback(
        (page: number, size?: number) => {
            setCurrentPage(page);
            if (size !== undefined) setPageSize(size);
        },
        [setCurrentPage, setPageSize],
    );

    return {
        records: result.data,
        total: result.total ?? 0,
        presentations: result['presentations'] as ReferencePresentations | undefined,
        loading: tableQuery.isFetching,
        error: tableQuery.isError ? tableQuery.error : null,
        filter,
        setFilter,
        search,
        setSearch,
        sort: order,
        setSort,
        page: currentPage,
        pageSize: currentPageSize,
        setPage,
    };
}
