import { Dropdown, Flex, Pagination, Switch, theme } from 'antd';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import type { ObjectView } from '../../../server/ui/descriptions';
import { compositeReference } from '../../../server/metadata/composite';
import { useSearchParams } from 'react-router';
import { RecordTablePart } from './record-table-part';
import { recordPath } from '../../common/paths';
import { useAction } from '../../data-provider/actions';
import { useObjectView } from '../../data-provider/metadata';
import { recordGuid, type RecordData } from '../../data-provider/records';
import { ListPresentationsContext } from '../../references/presentation';
import { FieldDisplay } from '../../widgets/registry';
import { actionSuccessMessage } from './action-button';
import { Button } from '../ds/button';
import { DataTable, type DataTableColumn } from '../ds/data-table';
import { Icons } from '../ds/icons';
import { Stack } from '../ds/stack';
import type { TableLayouts } from '../ds/table-layout';
import { fieldColumn } from './field-cells';
import type { FieldName, ListedObject } from './object-reference';
import type { RecordList } from './record-list';

/** Размеры страницы, которые предлагает таблица. */
const pageSizes = [20, 50, 100];

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
    /** Схемы отображения по точкам перелома: какие колонки объединить в составные, как у `TablePart`. */
    readonly layouts?: TableLayouts | undefined;
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
export function RecordTable<Row extends RecordData = RecordData>({ object, list, columns, hiddenRowActions, selected, onSelect, layouts }: RecordTableProperties<Row>) {
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
            layouts={layouts}
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
    readonly layouts: TableLayouts | undefined;
}

function DescribedTable({ object, list, columns: columnNames, hiddenRowActions, selected, onSelect, layouts }: DescribedTableProperties) {
    const { token } = theme.useToken();
    const navigate = useNavigate();
    const performAction = useAction();
    const { form } = object;
    const description = object.list;
    const [searchParameters, setSearchParameters] = useSearchParams();
    const expandAll = searchParameters.get('expandTableParts') === 'true';
    const [expandedKeys, setExpandedKeys] = useState<ReadonlyArray<string>>([]);
    const parts = description.tableParts ?? [];

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
    // Повторный щелчок по той же колонке меняет направление; список без сортировки не нужен.
    const sortBy = (field: string) => list.setSort([{
        field,
        direction: primarySort?.field === field && primarySort.direction === 'ascending' ? 'descending' : 'ascending',
    }]);

    const shown =
        columnNames === undefined
            ? description.columns
            : columnNames.flatMap((name) => description.columns.find((column) => column.field === name) ?? []);

    const columns: DataTableColumn<RecordData>[] = shown.map((column, index) => ({
        key: column.field,
        title: column.title,
        ...fieldColumn(column),
        sortable: sortable.has(column.field),
        // Первая колонка рисует ячейку сама: перед значением стоит отметка записи, а значение
        // открывает запись. Остальные колонки примитивного типа отдают значение, и таблица
        // форматирует его по типу; ссылки и составные значения показывает виджет реестра.
        ...(index > 0 && fieldColumn(column).type !== 'free' ? { value: (record: RecordData) => record[column.field] } : {}),
        ...(index > 0 && fieldColumn(column).type !== 'free' ? {} : { render: (record: RecordData) => {
            const value = record[column.field];
            const display = <FieldDisplay field={column} value={value} />;
            if (index > 0 || form === null) return display;
            // Ссылочная колонка открывает свою цель; вложенная ссылка перехватила бы переход к ней.
            if (column.kind === 'reference' || column.kind === 'objectReference' || column.kind === 'recorder' || compositeReference(value) !== null) {
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
        } }),
    }));

    if (formActions.has('markDeleted') || formActions.has('unmarkDeleted')) {
        columns.push({
            key: 'actions',
            title: '',
            type: 'free',
            size: 'control',
            render: (record: RecordData) => {
                const action = formActions.get(isMarkedDeleted(record) ? 'unmarkDeleted' : 'markDeleted');
                if (action === undefined) return null;
                return (
                    <Dropdown trigger={['click']} menu={{ items: [{ key: action.name, label: action.title }], onClick: () => toggleDeletionMark(record) }}>
                        <Button type="text" icon={<Icons.more />} aria-label="Действия с записью" />
                    </Dropdown>
                );
            },
        });
    }

    const toggleAll = (checked: boolean) => {
        const next = new URLSearchParams(searchParameters);
        if (checked) next.set('expandTableParts', 'true');
        else {
            next.delete('expandTableParts');
            setExpandedKeys([]);
        }
        setSearchParameters(next, { replace: true });
    };
    return (
        <ListPresentationsContext.Provider value={list.presentations}>
            <Stack gap={3}>
                {parts.length > 0 && <Flex gap="small" align="center"><Switch checked={expandAll} onChange={toggleAll} />Раскрыть строки страницы</Flex>}
                <DataTable<RecordData>
                    columns={columns}
                    rows={list.records}
                    rowKey={(record) => rowKey(object, record)}
                    layouts={layouts}
                    loading={list.loading}
                    emptyText="Записей нет"
                    sort={primarySort === undefined ? null : { key: primarySort.field, direction: primarySort.direction }}
                    onSort={sortBy}
                    {...(parts.length === 0 ? {} : {
                        expansion: {
                            isExpandable: () => true,
                            isExpanded: (record: RecordData) => expandAll || expandedKeys.includes(rowKey(object, record)),
                            onToggle: (record: RecordData, _index: number, open: boolean) => {
                                const key = rowKey(object, record);
                                setExpandedKeys((keys) => (open ? [...keys, key] : keys.filter((candidate) => candidate !== key)));
                            },
                            // Содержимое строится только у раскрытой строки: свёрнутая не читает свои строки с сервера.
                            render: (record: RecordData) => <Stack gap={3}>{parts.map((part) => <RecordTablePart key={part} object={object} guid={recordGuid(record)} part={part} />)}</Stack>,
                        },
                    })}
                    {...(selected === undefined ? {} : {
                        selection: {
                            mode: 'single' as const,
                            isSelected: (record: RecordData) => selected !== null && rowKey(object, record) === rowKey(object, selected),
                            onChange: (record: RecordData) => onSelect?.(record),
                        },
                        onRowClick: (record: RecordData) => onSelect?.(record),
                    })}
                    {...(form === null ? {} : { onRowDoubleClick: (record: RecordData) => void navigate(recordPath(object, recordGuid(record))) })}
                    // Помеченная на удаление запись остаётся в списке, но её строка бледнее обычной.
                    rowState={(record) => (description.deletionMark && isMarkedDeleted(record) ? 'muted' : undefined)}
                />
                <Flex justify="flex-end">
                    <Pagination
                        current={list.page}
                        pageSize={list.pageSize}
                        total={list.total}
                        showSizeChanger
                        pageSizeOptions={pageSizes}
                        showTotal={(total) => `Записей: ${total}`}
                        onChange={(page, size) => list.setPage(page, size)}
                    />
                </Flex>
            </Stack>
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
