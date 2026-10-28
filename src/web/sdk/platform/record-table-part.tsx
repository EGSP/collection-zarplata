import { Alert } from 'antd';
import { useMany } from '@refinedev/core';
import type { ApiError } from '../../common/api';
import type { FormTablePart } from '../../../server/ui/descriptions';
import { useObjectView } from '../../data-provider/metadata';
import type { RecordData } from '../../data-provider/records';
import { FieldDisplay } from '../../widgets/registry';
import { DataTable, type DataTableColumn } from '../ds/data-table';
import type { TableLayouts } from '../ds/table-layout';
import { fieldColumn } from './field-cells';
import type { ReadObject } from './object-reference';
import { resourceName } from '../../data-provider/perform';

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
    /** Схемы отображения по точкам перелома, как у `TablePart`. */
    readonly layouts?: TableLayouts | undefined;
}

/** Показывает часть только для чтения; одновременные просмотры загружаются общим пакетом get. */
export function RecordTablePart({ object, guid, part, onRowClick, selection, layouts }: RecordTablePartProperties) {
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
    return <ReadOnlyTablePart part={description} rows={Array.isArray(rows) ? rows : []} loading={query.isFetching} onRowClick={onRowClick} selection={selection} layouts={layouts} />;
}

/** Свойства таблицы уже прочитанных строк. */
export interface ReadOnlyTablePartProperties {
    readonly part: FormTablePart;
    readonly rows: ReadonlyArray<RecordData>;
    readonly loading?: boolean | undefined;
    readonly onRowClick?: ((row: RecordData) => void) | undefined;
    readonly selection?: RecordTableSelection | undefined;
    /** Схемы отображения по точкам перелома, как у `TablePart`. */
    readonly layouts?: TableLayouts | undefined;
}

/**
 * Таблица уже прочитанных строк; колонки совпадают с описанием формы, а их размеры выводятся
 * из видов полей. Строки сравниваются по номеру: таблица показывает те же объекты, что переданы в `rows`.
 */
export function ReadOnlyTablePart({ part, rows, loading = false, onRowClick, selection, layouts }: ReadOnlyTablePartProperties) {
    const locked = new Set(selection?.locked?.(rows) ?? []);
    const selected = new Set(selection?.selected(rows) ?? []);
    const columns = part.columns.map((field): DataTableColumn<RecordData> => ({
        key: field.name,
        title: field.title,
        ...fieldColumn(field),
        // Значение примитивного типа форматирует таблица, ссылку и составное значение — виджет реестра.
        ...(fieldColumn(field).type === 'free'
            ? { render: (row: RecordData) => <FieldDisplay field={field} value={row[field.name]} /> }
            : { value: (row: RecordData) => row[field.name] }),
    }));
    return (
        <DataTable<RecordData>
            columns={columns}
            rows={rows}
            rowKey={(_row, index) => index}
            layouts={layouts}
            loading={loading}
            // Недоступная для отметки строка залита серым, чтобы отличаться от строк, которые можно отметить.
            rowState={(_row, index) => (locked.has(index) ? 'locked' : undefined)}
            {...(onRowClick === undefined ? {} : { onRowClick: (row: RecordData) => onRowClick(row) })}
            {...(selection === undefined ? {} : {
                selection: {
                    mode: 'multiple' as const,
                    isSelected: (_row: RecordData, index: number) => selected.has(index),
                    isDisabled: (_row: RecordData, index: number) => selection.disabled === true || locked.has(index),
                    onChange: (_row: RecordData, index: number, checked: boolean) => selection.onToggle(rows, index, checked),
                    onChangeAll: (checked: boolean) => selection.onToggleAll(rows, checked),
                },
            })}
        />
    );
}
