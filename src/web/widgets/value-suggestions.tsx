import { AutoComplete } from 'antd';
import { useList, type CrudFilter } from '@refinedev/core';
import { useEffect, useState } from 'react';
import { useDebounced } from '../common/debounced';
import { searchFilters, crudSort } from '../data-provider/data-provider';
import { useObjectView } from '../data-provider/metadata';
import { resourceName } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import type { ApiError } from '../common/api';
import { listRecordPresentation } from '../references/presentation';
import type { ReferencePresentations } from '../../server/ui/reference-presentation';
import { formatMoney, formatNumber } from './format';
import { defined, useInputHandle } from './inputs';
import type { InputProperties } from './widget';

/**
 * Числовой ввод с подсказками по названию и числу. Запросы идут только при открытом выборе;
 * в форме остаётся число, которое можно изменить или ввести без выбора записи.
 */
export function ValueSuggestionInput({ field, value, onChange, disabled, id, ref }: InputProperties<number>) {
    const source = field.suggestions!;
    const object = useObjectView(source.target);
    const [open, setOpen] = useState(false);
    const scale = field.kind === 'money' ? 100 : 1;
    const textOf = (value: number | null | undefined) => value == null ? '' : String(value / scale).replace('.', ',');
    const [text, setText] = useState(() => textOf(value));
    const [search, setSearch] = useState('');
    const searched = useDebounced(search, 300);
    useEffect(() => setText(textOf(value)), [value, scale]);
    const conditions: CrudFilter[] = [
        { field: 'deletedAt', operator: 'null', value: true },
        { field: source.field, operator: 'nnull', value: true },
        ...searchFilters(searched),
    ];
    const { result, query } = useList<RecordData, ApiError>({
        resource: resourceName(source.target), filters: conditions,
        sorters: object?.list.defaultSort.map(crudSort) ?? [],
        pagination: { currentPage: 1, pageSize: 50 },
        queryOptions: { enabled: open && object !== undefined },
        errorNotification: false,
    });
    const presentations = result['presentations'] as ReferencePresentations | undefined;
    const records = result.data.filter((record) => typeof record[source.field] === 'number');
    const inner = useInputHandle(ref);
    const select = (guid: string): boolean => {
        const record = records.find((record) => record['guid'] === guid);
        if (record === undefined) return false;
        const number = record[source.field] as number;
        setText(textOf(number));
        onChange?.(number);
        return true;
    };
    return <div data-picker-open={open}><AutoComplete ref={inner} {...defined({ id, disabled })} style={{ width: '100%' }}
        value={text} onOpenChange={(opened) => { setOpen(opened); if (!opened) setSearch(''); }}
        options={object === undefined ? [] : records.map((record) => ({ value: String(record['guid']), label: listRecordPresentation(object, record, presentations) + ' · ' + (field.kind === 'money' ? formatMoney(record[source.field] as number) : formatNumber(record[source.field] as number)) }))}
        onSearch={setSearch} notFoundContent={query.isFetching ? 'Загрузка…' : object === undefined ? 'Нет доступа' : 'Ничего не найдено'}
        onChange={(entered) => {
            if (select(entered)) return;
            setText(entered);
            if (entered === '') onChange?.(null);
            else { const number = Number(entered.replace(',', '.')); if (Number.isFinite(number)) onChange?.(field.kind === 'money' ? Math.round(number * scale) : number); }
        }} onBlur={() => setText(textOf(value))} /></div>;
}
