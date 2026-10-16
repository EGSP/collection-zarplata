import { Alert, Table, theme } from 'antd';
import { useMany } from '@refinedev/core';
import type { ApiError } from '../common/api';
import type { FormTablePart } from '../../server/ui/descriptions';
import { useObjectView } from '../data-provider/metadata';
import type { RecordData } from '../data-provider/records';
import { FieldDisplay } from '../widgets/registry';
import type { ReadObject } from './object-reference';
import { resourceName } from '../data-provider/perform';

/**
 * Отметка строк просмотра флажками. Отметки хранит вызывающий экран: просмотр только показывает
 * их и сообщает об изменении. Строки передаются целиком, потому что состояние строки может зависеть
 * от остальных, например от одинаковых строк рядом.
 */
export interface RecordTableSelection {
    /** Номера отмеченных строк среди всех прочитанных строк части. */
    readonly selected: (rows: ReadonlyArray<RecordData>) => ReadonlyArray<number>;
    /** Пользователь отметил или снял отметку со строки `index`. */
    readonly onToggle: (rows: ReadonlyArray<RecordData>, index: number, checked: boolean) => void;
    /** Пользователь отметил или снял отметки флажком в заголовке: у всех строк сразу. */
    readonly onToggleAll: (rows: ReadonlyArray<RecordData>, checked: boolean) => void;
    /**
     * Номера строк, которые отметить нельзя: флажок недоступен, а строка залита светло-серым.
     * Например, товар, который уже возвращён. Такая строка не входит в `selected`.
     */
    readonly locked?: ((rows: ReadonlyArray<RecordData>) => ReadonlyArray<number>) | undefined;
    /** Отметки нельзя менять: форма открыта только для просмотра. */
    readonly disabled?: boolean | undefined;
}

/** Свойства просмотра строк записи; нажатие передаёт экрану строку без изменения записи. */
export interface RecordTablePartProperties {
    readonly object: ReadObject<RecordData>;
    readonly guid: string;
    readonly part: string;
    readonly onRowClick?: ((row: RecordData) => void) | undefined;
    readonly selection?: RecordTableSelection | undefined;
}

/** Показывает часть только для чтения; одновременные просмотры загружаются общим пакетом get. */
export function RecordTablePart({ object, guid, part, onRowClick, selection }: RecordTablePartProperties) {
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
    return <ReadOnlyTablePart part={description} rows={Array.isArray(rows) ? rows : []} loading={query.isFetching} onRowClick={onRowClick} selection={selection} />;
}

/** Таблица уже прочитанных строк; колонки совпадают с описанием формы. */
export function ReadOnlyTablePart({ part, rows, loading = false, onRowClick, selection }: { readonly part: FormTablePart; readonly rows: ReadonlyArray<RecordData>; readonly loading?: boolean; readonly onRowClick?: ((row: RecordData) => void) | undefined; readonly selection?: RecordTableSelection | undefined }) {
    const { token } = theme.useToken();
    const locked = new Set(selection?.locked?.(rows) ?? []);
    return <Table<RecordData> size="small" pagination={false} loading={loading} dataSource={[...rows]} rowKey={(_row, index) => index!}
        columns={part.columns.map((field) => ({ key: field.name, dataIndex: field.name, title: field.title, render: (value: unknown) => <FieldDisplay field={field} value={value} /> }))}
        {...(selection === undefined ? {} : { rowSelection: {
            selectedRowKeys: [...selection.selected(rows)],
            columnWidth: 48,
            getCheckboxProps: (row: RecordData) => ({ disabled: selection.disabled === true || locked.has(rows.indexOf(row)) }),
            // Таблица показывает те же объекты строк, что переданы в `rows`, поэтому номер строки находится по ссылке.
            onSelectAll: (checked: boolean) => selection.onToggleAll(rows, checked),
            onSelect: (row: RecordData, checked: boolean) => selection.onToggle(rows, rows.indexOf(row), checked),
        } })}
        onRow={(row) => ({
            ...(onRowClick === undefined ? {} : { onClick: () => onRowClick(row), style: { cursor: 'pointer' } }),
            // Недоступная для отметки строка залита серым, чтобы отличаться от строк, которые можно отметить.
            ...(locked.has(rows.indexOf(row)) ? { style: { background: token.colorFillTertiary, color: token.colorTextTertiary } } : {}),
        })} locale={{ emptyText: 'Строк нет' }} />;
}
