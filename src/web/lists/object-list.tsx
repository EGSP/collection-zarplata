import { CheckCircleOutlined, DeleteOutlined, MoreOutlined, PlusOutlined } from '@ant-design/icons';
import { useTable, type CrudSort } from '@refinedev/core';
import { Alert, Button, Dropdown, Flex, Table, theme, Typography, type TableProps } from 'antd';
import { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import type { ListColumn, ObjectView } from '../../server/ui/descriptions';
import type { ApiError } from '../common/api';
import { newRecordPath, recordPath, type ListLocationState } from '../common/paths';
import { useAction } from '../data-provider/actions';
import { crudSort } from '../data-provider/data-provider';
import { resourceName } from '../data-provider/perform';
import { recordGuid, type RecordData } from '../data-provider/records';
import { FieldDisplay } from '../widgets/registry';
import { ListFilters } from './list-filters';

/** Размеры страницы, которые предлагает список, и размер при открытии. */
const pageSizes = [20, 50, 100];
const defaultPageSize = 50;

/** Виды полей, значения которых в колонке прижимаются к правому краю, как принято для чисел. */
const rightAligned: ReadonlySet<ListColumn['kind']> = new Set(['number', 'money']);

/**
 * Список объекта конфигурации: таблица, отбор, сортировка и страницы по описанию списка.
 *
 * Список строится только по описанию с сервера, поэтому новый объект конфигурации получает его
 * без изменений клиента. Сортировку, отбор и номер страницы хранит Refine в адресе страницы:
 * после возврата из формы список открывается в прежнем состоянии, а адрес с отбором можно
 * сохранить в закладки.
 *
 * У справочников и документов строка открывает форму записи, а меню строки ставит и снимает
 * пометку удаления. Оба вида регистров показывают список без формы; сведения изменяются
 * через API, а движения записывают документы при проведении.
 */
export function ObjectList({ object }: { readonly object: ObjectView }) {
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const location = useLocation();
    const performAction = useAction();
    const resource = resourceName(object);
    const { list, form } = object;

    const { tableQuery, result, sorters, setSorters, filters, setFilters, currentPage, setCurrentPage, pageSize, setPageSize } = useTable<RecordData, ApiError>({
        resource,
        syncWithLocation: true,
        pagination: { pageSize: defaultPageSize },
        sorters: { initial: list.defaultSort.map(crudSort) },
        filters: { defaultBehavior: 'replace' },
    });

    const formActions = useMemo(() => new Set(form?.actions.map((action) => action.name)), [form]);
    const listState: ListLocationState = { list: location.pathname + location.search };
    const openRecord = (record: RecordData) => void navigate(recordPath(object, recordGuid(record)), { state: listState });

    const toggleDeletionMark = (record: RecordData) => {
        const marked = record['deletedAt'] !== null;
        // Отказ сервера показывает уведомление, а список после него остаётся прежним.
        performAction({
            resource,
            action: marked ? 'unmarkDeleted' : 'markDeleted',
            payload: { guid: recordGuid(record) },
            successMessage: marked ? 'Пометка удаления снята' : 'Запись помечена на удаление',
        }).catch(() => undefined);
    };

    // Значок сортировки показывает только старшее поле: щелчок по заголовку заменяет сортировку одной колонкой.
    const primarySort: CrudSort | undefined = sorters[0];
    const sortable = new Set(list.sortable);

    const columns: NonNullable<TableProps<RecordData>['columns']> = list.columns.map((column, index) => ({
        key: column.field,
        dataIndex: column.field,
        title: column.title,
        align: rightAligned.has(column.kind) ? 'right' : 'left',
        sorter: sortable.has(column.field),
        sortOrder: primarySort?.field === column.field ? (primarySort.order === 'asc' ? 'ascend' : 'descend') : null,
        // Третий щелчок по заголовку у Ant Design отменяет сортировку. Список без сортировки не нужен,
        // поэтому третий щелчок снова включает сортировку по возрастанию.
        sortDirections: ['ascend', 'descend', 'ascend'],
        render: (value: unknown, record: RecordData) => {
            const display = <FieldDisplay field={column} value={value} />;
            if (index > 0 || form === null) return display;
            // Ссылочная колонка открывает свою цель; вложенная ссылка перехватила бы переход к ней.
            if (column.kind === 'reference' || column.kind === 'objectReference' || column.kind === 'recorder') {
                return <Flex gap="small" align="center"><RecordMark record={record} />{display}</Flex>;
            }
            return (
                <Flex gap="small" align="center">
                    <RecordMark record={record} />
                    <Link to={recordPath(object, recordGuid(record))} state={listState}>
                        {/* Пустое значение первой колонки не должно скрывать переход к записи. */}
                        {value === null || value === '' ? '(не заполнено)' : display}
                    </Link>
                </Flex>
            );
        },
    }));

    if (form !== null && (formActions.has('markDeleted') || formActions.has('unmarkDeleted'))) {
        columns.push({
            key: 'actions',
            width: 48,
            render: (_value: unknown, record: RecordData) => {
                const action = record['deletedAt'] === null ? 'markDeleted' : 'unmarkDeleted';
                if (!formActions.has(action)) return null;
                return (
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [{ key: action, label: action === 'markDeleted' ? 'Пометить на удаление' : 'Снять пометку удаления' }],
                            onClick: () => toggleDeletionMark(record),
                        }}
                    >
                        <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Действия с записью" />
                    </Dropdown>
                );
            },
        });
    }

    const onTableChange: NonNullable<TableProps<RecordData>['onChange']> = (pagination, _filters, sorter, { action }) => {
        if (action === 'sort' && !Array.isArray(sorter) && sorter.columnKey !== undefined) {
            setSorters([{ field: String(sorter.columnKey), order: sorter.order === 'descend' ? 'desc' : 'asc' }]);
            setCurrentPage(1);
        }
        if (action === 'paginate') {
            setCurrentPage(pagination.current ?? 1);
            setPageSize(pagination.pageSize ?? defaultPageSize);
        }
    };

    return (
        <Flex vertical gap="middle">
            <Flex justify="space-between" align="center">
                <Typography.Title level={3} style={{ margin: 0 }}>
                    {object.title}
                </Typography.Title>
                {formActions.has('save') && (
                    <Button type="primary" icon={<PlusOutlined />} onClick={() => void navigate(newRecordPath(object), { state: listState })}>
                        Создать
                    </Button>
                )}
            </Flex>
            <ListFilters
                filters={list.filters}
                applied={filters}
                onApply={(next) => {
                    setFilters(next, 'replace');
                    // Номер страницы относится к прежнему отбору: в новом такой страницы может не быть.
                    setCurrentPage(1);
                }}
            />
            {tableQuery.isError && <Alert type="error" showIcon title="Не удалось загрузить список" description={tableQuery.error.message} />}
            <Table<RecordData>
                size="small"
                rowKey={(record) => rowKey(object, record)}
                columns={columns}
                dataSource={result.data}
                loading={tableQuery.isFetching}
                onChange={onTableChange}
                pagination={{
                    current: currentPage,
                    pageSize,
                    total: result.total ?? 0,
                    showSizeChanger: true,
                    pageSizeOptions: pageSizes,
                    showTotal: (total) => `Записей: ${total}`,
                }}
                onRow={(record) => ({
                    ...(form === null ? {} : { onDoubleClick: () => openRecord(record) }),
                    // Помеченная на удаление запись остаётся в списке, но её строка бледнее обычной.
                    ...(list.deletionMark && isMarkedDeleted(record) ? { style: { color: token.colorTextDisabled } } : {}),
                })}
            />
        </Flex>
    );
}

function isMarkedDeleted(record: RecordData): boolean {
    return record['deletedAt'] !== null && record['deletedAt'] !== undefined;
}

/**
 * Ключ строки таблицы. У справочников и документов это `guid`. У строки регистра его нет:
 * строку определяют регистратор и номер строки. У сведений ключ состоит из всех измерений;
 * JSON-массив сохраняет типы и границы значений, даже если строки содержат разделители.
 */
function rowKey(object: ObjectView, record: RecordData): string {
    if (object.kind === 'informationRegister') {
        return JSON.stringify(object.list.columns.filter((column) => column.role === 'dimension').map((column) => record[column.field]));
    }
    if (object.kind !== 'register') return recordGuid(record);
    const recorder = record['recorder'] as { readonly document: string; readonly guid: string };
    return `${recorder.document}/${recorder.guid}/${String(record['lineNumber'])}`;
}

/** Значок состояния записи в первой колонке: пометка удаления либо проведение документа. */
function RecordMark({ record }: { readonly record: RecordData }) {
    const { token } = theme.useToken();
    if (isMarkedDeleted(record)) return <DeleteOutlined title="Помечен на удаление" style={{ color: token.colorError }} />;
    if (record['posted'] === true) return <CheckCircleOutlined title="Проведён" style={{ color: token.colorSuccess }} />;
    return null;
}
