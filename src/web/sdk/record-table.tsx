import { Button, Dropdown, Flex, Table, theme, type TableProps } from 'antd';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ListColumn, ObjectView } from '../../server/ui/descriptions';
import { recordPath } from '../common/paths';
import { useAction } from '../data-provider/actions';
import { useObjectView } from '../data-provider/metadata';
import { recordGuid, type RecordData } from '../data-provider/records';
import { ListPresentationsContext } from '../references/presentation';
import { FieldDisplay } from '../widgets/registry';
import { actionSuccessMessage } from './action-button';
import { Icons } from './icons';
import type { FieldName, ListedObject } from './object-reference';
import type { RecordList } from './record-list';

/** Размеры страницы, которые предлагает таблица. */
const pageSizes = [20, 50, 100];

/** Виды полей, значения которых в колонке прижимаются к правому краю, как принято для чисел. */
const rightAligned: ReadonlySet<ListColumn['kind']> = new Set(['number', 'money']);

/** Свойства таблицы записей объекта со строками типа `Row`. */
export interface RecordTableProperties<Row extends RecordData = RecordData> {
    /**
     * Объект, записи которого показывает таблица: ссылка на объект конфигурации либо его описание
     * `ObjectView`. Колонки, сортируемые поля и доступные действия таблица берёт из описания объекта.
     */
    readonly object: ListedObject<Row>;
    /** Страница списка этого же объекта от `useRecordList`. */
    readonly list: RecordList<Row>;
    /**
     * Имена полей, которые выводятся колонками, в порядке показа. Без свойства выводятся все
     * колонки описания списка. У ссылки на объект имена проверяет компилятор. Поле, которого нет
     * среди колонок описания списка, например `guid`, не выводится.
     */
    readonly columns?: ReadonlyArray<FieldName<Row>> | undefined;
    /** Действия, скрытые экраном в меню строки. Серверные права и форма записи не меняются. */
    readonly hiddenRowActions?: ReadonlyArray<string> | undefined;
    /**
     * Выбранная строка либо `null`. Если свойство задано, таблица показывает выбор строки
     * и сообщает о нём через `onSelect`. Строка сравнивается по ключу записи, поэтому выбранной
     * остаётся и запись, перечитанная с сервера.
     */
    readonly selected?: Row | null | undefined;
    /** Пользователь выбрал строку. Выбор хранит экран: таблица показывает то, что получила в `selected`. */
    readonly onSelect?: ((record: Row) => void) | undefined;
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
 *
 * Если описания объекта нет, у пользователя нет права его читать. Тогда таблица не выводится:
 * чтение списка завершилось отказом сервера, и его показывает экран по `list.error`.
 */
export function RecordTable<Row extends RecordData = RecordData>({ object, list, columns, hiddenRowActions, selected, onSelect }: RecordTableProperties<Row>) {
    const view = useObjectView(object);
    if (view === undefined) return null;
    // Точный тип строки нужен только экрану: таблица строит колонки по описанию с сервера и читает значения по именам.
    return (
        <DescribedTable
            object={view}
            list={list}
            columns={columns}
            hiddenRowActions={hiddenRowActions}
            selected={selected}
            onSelect={onSelect as ((record: RecordData) => void) | undefined}
        />
    );
}

interface DescribedTableProperties {
    readonly object: ObjectView;
    readonly list: RecordList;
    readonly columns: ReadonlyArray<string> | undefined;
    readonly hiddenRowActions: ReadonlyArray<string> | undefined;
    readonly selected: RecordData | null | undefined;
    readonly onSelect: ((record: RecordData) => void) | undefined;
}

function DescribedTable({ object, list, columns: columnNames, hiddenRowActions, selected, onSelect }: DescribedTableProperties) {
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const performAction = useAction();
    const { form } = object;
    const description = object.list;

    const formActions = useMemo(() => new Map(form?.actions.filter((action) => !hiddenRowActions?.includes(action.name)).map((action) => [action.name, action])), [form, hiddenRowActions]);

    const toggleDeletionMark = (record: RecordData) => {
        const action = formActions.get(isMarkedDeleted(record) ? 'unmarkDeleted' : 'markDeleted');
        if (action === undefined) return;
        // Отказ сервера показывает уведомление, а список после него остаётся прежним.
        performAction({ object, action: action.name, payload: { guid: recordGuid(record) }, successMessage: actionSuccessMessage(action) }).catch(() => undefined);
    };

    // Значок сортировки показывает только старшее поле: щелчок по заголовку заменяет сортировку одной колонкой.
    const primarySort = list.sort[0];
    const sortable = new Set(description.sortable);

    const shown =
        columnNames === undefined
            ? description.columns
            : columnNames.flatMap((name) => description.columns.find((column) => column.field === name) ?? []);

    const columns: NonNullable<TableProps<RecordData>['columns']> = shown.map((column, index) => ({
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
                        <Button type="text" size="small" icon={<Icons.more />} aria-label="Действия с записью" />
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
                {...(selected === undefined
                    ? {}
                    : {
                          rowSelection: {
                              type: 'radio' as const,
                              selectedRowKeys: selected === null ? [] : [rowKey(object, selected)],
                              onSelect: (record: RecordData) => onSelect?.(record),
                          },
                      })}
                onRow={(record) => ({
                    ...(selected === undefined ? {} : { onClick: () => onSelect?.(record) }),
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
    if (isMarkedDeleted(record)) return <Icons.markedDeleted title="Помечен на удаление" style={{ color: token.colorError }} />;
    if (record['posted'] === true) return <Icons.posted title="Проведён" style={{ color: token.colorSuccess }} />;
    return null;
}
