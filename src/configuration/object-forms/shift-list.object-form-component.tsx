import { Alert, Flex, Pagination, theme } from 'antd';
import { Link } from 'react-router';
import {
    DataTable, FieldDisplay, Icons, ListFilters, ListSearch, Page, ShellGroupContent, ShellGroups, Stack,
    listRecordPresentation, recordGuid, recordPath, useObjectView, useOpenRecord, useRecordList, useRecords,
    type DataTableColumn, type ListFormProperties, type RecordData,
} from '../../web/sdk';
import { Objects } from '../objects.generated';

const shift = Objects.document.shift;
const employees = Objects.catalog.employees;
const pageSizes = [20, 50, 100];

/**
 * Список смен с колонкой «Сотрудники». Кнопки открытия и закрытия остаются в блоке «Текущая смена».
 * Список хранит поиск, отбор, сортировку и страницу в адресе вкладки.
 */
export default function ShiftListForm({ object }: ListFormProperties) {
    const list = useRecordList(object, { sort: object.list.defaultSort, address: true });
    const openRecord = useOpenRecord();
    const { token } = theme.useToken();
    const employeeView = useObjectView(employees);
    const employeeField = object.tableParts?.find((part) => part.name === 'employees')?.columns.find((field) => field.name === 'employee');
    const canReadEmployees = employeeField !== undefined && employeeField.access !== 'deny' && employeeView !== undefined;

    // Список отдаёт только шапки. Составы читаем общим пакетом get для текущей страницы.
    const shiftRecords = useRecords(shift, canReadEmployees ? list.records.map(recordGuid) : []);
    const employeeGuids = [...new Set([...shiftRecords.records.values()].flatMap(
        (record) => (record.employees ?? []).map((line) => line.employee),
    ))];
    const employeeRecords = useRecords(employees, canReadEmployees ? employeeGuids : []);

    /** Берёт ФИО из представлений сотрудников и сохраняет порядок строк смены. */
    function employeeNames(record: RecordData): string {
        if (!canReadEmployees || employeeView === undefined) return 'Нет доступа';
        const composition = shiftRecords.records.get(recordGuid(record))?.employees;
        if (shiftRecords.error !== null || employeeRecords.error !== null) return 'Не удалось прочитать состав';
        if (composition === undefined) return 'Загрузка…';
        return composition.map(({ employee }) => {
            const employeeRecord = employeeRecords.records.get(employee);
            if (employeeRecord === undefined) return employeeRecords.loading ? 'Загрузка…' : 'Запись недоступна';
            return listRecordPresentation(employeeView, employeeRecord, undefined);
        }).join(', ');
    }

    const columns: DataTableColumn<RecordData>[] = object.list.columns.map((column) => ({
        key: column.field,
        title: column.title,
        type: column.kind === 'boolean' || column.kind === 'dateTime' ? column.kind : 'string',
        sortable: object.list.sortable.includes(column.field),
        render: (record) => {
            if (column.access === 'deny') return 'Нет доступа';
            const value = <FieldDisplay field={column} value={record[column.field]} />;
            if (column.field !== 'number') return value;
            return (
                <Flex align="center" gap="small">
                    {record.deletedAt != null
                        ? <Icons.markedDeleted title="Помечен на удаление" style={{ color: token.colorError }} />
                        : record.posted === true && <Icons.posted title="Проведён" style={{ color: token.colorSuccess }} />}
                    <Link to={recordPath(object, recordGuid(record))}>{value}</Link>
                </Flex>
            );
        },
    }));
    columns.push({ key: 'employees', title: 'Сотрудники', type: 'string', value: employeeNames });

    const primarySort = list.sort[0];
    return (
        <Page title={object.title}>
            <ShellGroupContent group={ShellGroups.list(object)} />
            <ListSearch value={list.search} onSearch={list.setSearch} />
            <ListFilters filters={object.list.filters} applied={list.filter} onApply={list.setFilter} />
            {list.error !== null && <Alert type="error" showIcon title="Не удалось загрузить список" description={list.error.message} />}
            <Stack gap={3}>
                <DataTable
                    columns={columns}
                    rows={list.records}
                    rowKey={recordGuid}
                    pagination="external"
                    loading={list.loading}
                    emptyText="Записей нет"
                    sort={primarySort === undefined ? null : { key: primarySort.field, direction: primarySort.direction }}
                    onSort={(field) => list.setSort([{
                        field,
                        direction: primarySort?.field === field && primarySort.direction === 'ascending' ? 'descending' : 'ascending',
                    }])}
                    onRowDoubleClick={(record) => void openRecord(object, recordGuid(record))}
                    rowState={(record) => record.deletedAt == null ? undefined : 'muted'}
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
        </Page>
    );
}
