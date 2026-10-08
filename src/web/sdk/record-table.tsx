import { CheckCircleOutlined, DeleteOutlined, MoreOutlined } from '@ant-design/icons';
import { Button, Dropdown, Flex, Table, theme, type TableProps } from 'antd';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ListColumn, ObjectView } from '../../server/ui/descriptions';
import { recordPath } from '../common/paths';
import { useAction } from '../data-provider/actions';
import { recordGuid, type RecordData } from '../data-provider/records';
import { ListPresentationsContext } from '../references/presentation';
import { FieldDisplay } from '../widgets/registry';
import { actionSuccessMessage } from './action-button';
import type { RecordList } from './record-list';

/** Размеры страницы, которые предлагает таблица. */
const pageSizes = [20, 50, 100];

/** Виды полей, значения которых в колонке прижимаются к правому краю, как принято для чисел. */
const rightAligned: ReadonlySet<ListColumn['kind']> = new Set(['number', 'money']);

/** Свойства таблицы записей. */
export interface RecordTableProperties {
    /** Описание объекта: из него берутся колонки, сортируемые поля и действия, доступные пользователю. */
    readonly object: ObjectView;
    /** Страница списка этого же объекта от `useRecordList`. */
    readonly list: RecordList;
}

/**
 * Таблица записей объекта по описанию списка: колонки, сортировка по заголовку и переключение страниц.
 *
 * Таблица строится только по описанию с сервера, поэтому новый объект конфигурации получает её
 * без изменений клиента. Сама она записи не читает: страницу, сортировку и номер страницы ведёт
 * `useRecordList`, а таблица их показывает и меняет. Поэтому отбор и поиск экран размещает отдельно
 * от таблицы и там, где ему нужно.
 *
 * У справочников и документов строка открывает форму записи, а меню строки ставит и снимает
 * пометку удаления, если эти действия доступны пользователю. Оба вида регистров показывают
 * таблицу без формы и меню.
 */
export function RecordTable({ object, list }: RecordTableProperties) {
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const performAction = useAction();
    const { form } = object;
    const description = object.list;

    const formActions = useMemo(() => new Map(form?.actions.map((action) => [action.name, action])), [form]);

    const toggleDeletionMark = (record: RecordData) => {
        const action = formActions.get(isMarkedDeleted(record) ? 'unmarkDeleted' : 'markDeleted');
        if (action === undefined) return;
        // Отказ сервера показывает уведомление, а список после него остаётся прежним.
        performAction({ object, action: action.name, payload: { guid: recordGuid(record) }, successMessage: actionSuccessMessage(action) }).catch(() => undefined);
    };

    // Значок сортировки показывает только старшее поле: щелчок по заголовку заменяет сортировку одной колонкой.
    const primarySort = list.sort[0];
    const sortable = new Set(description.sortable);

    const columns: NonNullable<TableProps<RecordData>['columns']> = description.columns.map((column, index) => ({
        key: column.field,
        dataIndex: column.field,
        title: column.title,
        align: rightAligned.has(column.kind) ? 'right' : 'left',
        sorter: sortable.has(column.field),
        sortOrder: primarySort?.field === column.field ? (primarySort.direction === 'ascending' ? 'ascend' : 'descend') : null,
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
                    <Link to={recordPath(object, recordGuid(record))}>
                        {/* Пустое значение первой колонки не должно скрывать переход к записи. */}
                        {value === null || value === '' ? '(не заполнено)' : display}
                    </Link>
                </Flex>
            );
        },
    }));

    if (formActions.has('markDeleted') || formActions.has('unmarkDeleted')) {
        columns.push({
            key: 'actions',
            width: 48,
            render: (_value: unknown, record: RecordData) => {
                const action = formActions.get(isMarkedDeleted(record) ? 'unmarkDeleted' : 'markDeleted');
                if (action === undefined) return null;
                return (
                    <Dropdown trigger={['click']} menu={{ items: [{ key: action.name, label: action.title }], onClick: () => toggleDeletionMark(record) }}>
                        <Button type="text" size="small" icon={<MoreOutlined />} aria-label="Действия с записью" />
                    </Dropdown>
                );
            },
        });
    }

    const onTableChange: NonNullable<TableProps<RecordData>['onChange']> = (pagination, _filters, sorter, { action }) => {
        if (action === 'sort' && !Array.isArray(sorter) && sorter.columnKey !== undefined) {
            list.setSort([{ field: String(sorter.columnKey), direction: sorter.order === 'descend' ? 'descending' : 'ascending' }]);
        }
        if (action === 'paginate') list.setPage(pagination.current ?? 1, pagination.pageSize ?? list.pageSize);
    };

    return (
        <ListPresentationsContext.Provider value={list.presentations}>
            <Table<RecordData>
                size="small"
                rowKey={(record) => rowKey(object, record)}
                columns={columns}
                dataSource={[...list.records]}
                loading={list.loading}
                onChange={onTableChange}
                pagination={{
                    current: list.page,
                    pageSize: list.pageSize,
                    total: list.total,
                    showSizeChanger: true,
                    pageSizeOptions: pageSizes,
                    showTotal: (total) => `Записей: ${total}`,
                }}
                onRow={(record) => ({
                    ...(form === null ? {} : { onDoubleClick: () => void navigate(recordPath(object, recordGuid(record))) }),
                    // Помеченная на удаление запись остаётся в списке, но её строка бледнее обычной.
                    ...(description.deletionMark && isMarkedDeleted(record) ? { style: { color: token.colorTextDisabled } } : {}),
                })}
            />
        </ListPresentationsContext.Provider>
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
