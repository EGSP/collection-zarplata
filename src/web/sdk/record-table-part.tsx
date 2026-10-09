import { Alert, Table } from 'antd';
import { useMany } from '@refinedev/core';
import type { ApiError } from '../common/api';
import type { FormTablePart } from '../../server/ui/descriptions';
import { useObjectView } from '../data-provider/metadata';
import type { RecordData } from '../data-provider/records';
import { FieldDisplay } from '../widgets/registry';
import type { ReadObject } from './object-reference';
import { resourceName } from '../data-provider/perform';

/** Свойства просмотра строк записи; нажатие передаёт экрану строку без изменения записи. */
export interface RecordTablePartProperties {
    readonly object: ReadObject<RecordData>;
    readonly guid: string;
    readonly part: string;
    readonly onRowClick?: ((row: RecordData) => void) | undefined;
}

/** Показывает часть только для чтения; одновременные просмотры загружаются общим пакетом get. */
export function RecordTablePart({ object, guid, part, onRowClick }: RecordTablePartProperties) {
    const view = useObjectView(object);
    const { query } = useMany<RecordData, ApiError>({
        resource: resourceName(object), ids: [guid],
        queryOptions: { enabled: view !== undefined, placeholderData: () => undefined }, errorNotification: false,
    });
    const description = view?.tableParts?.find((candidate) => candidate.name === part);
    if (view === undefined) return <Alert type="warning" title="Нет доступа" />;
    if (query.isError) return <Alert type="error" title="Не удалось прочитать строки" description={query.error.message} />;
    if (description === undefined) return <Alert type="warning" title="Табличная часть недоступна" />;
    const rows = query.data?.data[0]?.[part];
    return <ReadOnlyTablePart part={description} rows={Array.isArray(rows) ? rows : []} loading={query.isFetching} onRowClick={onRowClick} />;
}

/** Таблица уже прочитанных строк; колонки совпадают с описанием формы. */
export function ReadOnlyTablePart({ part, rows, loading = false, onRowClick }: { readonly part: FormTablePart; readonly rows: ReadonlyArray<RecordData>; readonly loading?: boolean; readonly onRowClick?: ((row: RecordData) => void) | undefined }) {
    return <Table<RecordData> size="small" pagination={false} loading={loading} dataSource={[...rows]} rowKey={(_row, index) => index!}
        columns={part.columns.map((field) => ({ key: field.name, dataIndex: field.name, title: field.title, render: (value: unknown) => <FieldDisplay field={field} value={value} /> }))}
        onRow={(row) => onRowClick === undefined ? {} : { onClick: () => onRowClick(row), style: { cursor: 'pointer' } }} locale={{ emptyText: 'Строк нет' }} />;
}
