import { useList, type CrudFilter } from '@refinedev/core';
import { Button, Flex, Input, Select } from 'antd';
import { Link } from 'react-router';
import { recordPath } from '../common/paths';
import { useMemo, useState } from 'react';
import type { ObjectView } from '../../server/ui/descriptions';
import type { ApiError } from '../common/api';
import { useDebounced } from '../common/debounced';
import { crudSort } from '../data-provider/data-provider';
import { useObjectView } from '../data-provider/metadata';
import { resourceName } from '../data-provider/perform';
import { recordGuid, type RecordData } from '../data-provider/records';
import { defined, useInputHandle } from '../widgets/inputs';
import type { FieldValues, InputProperties } from '../widgets/widget';
import { recordPresentation, useReferencePresentation } from './presentation';
import { noAccessText } from './reference-display';

/** Сколько записей поле предлагает на выбор. Остальные пользователь находит, уточняя текст поиска. */
const suggestionCount = 20;

/** Задержка поиска после ввода, в миллисекундах: запрос уходит, когда пользователь перестал печатать. */
const searchDelay = 300;

/**
 * Поле ввода ссылки: выпадающий список с поиском по записям целевого объекта. Значением поля
 * служит `guid` выбранной записи, а пользователь видит её представление.
 *
 * Если целевого объекта нет в описаниях, у пользователя нет права его читать. Тогда записи
 * не запрашиваются, вместо представления написано «Нет доступа», а выбрать другую запись нельзя.
 */
export function ReferenceInput(properties: InputProperties<FieldValues['reference']>) {
    const object = useObjectView(properties.field.target);
    const inner = useInputHandle(object === undefined ? properties.ref : undefined);
    if (object === undefined) return <Input ref={inner} {...defined({ id: properties.id })} disabled value={noAccessText} />;
    return (
        <Flex gap="small" align="center">
            <div style={{ flex: 1, minWidth: 0 }}><ReferenceSelect {...properties} object={object} /></div>
            {properties.value != null && (
                <Link to={recordPath(object, properties.value)}><Button>Открыть запись</Button></Link>
            )}
        </Flex>
    );
}

function ReferenceSelect({ object, field, value, onChange, disabled, id, ref }: InputProperties<FieldValues['reference']> & { readonly object: ObjectView }) {
    const inner = useInputHandle(ref);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const searched = useDebounced(search, searchDelay);

    const filters = useMemo(() => {
        const conditions: Array<CrudFilter> = [];
        // Помеченную на удаление запись выбрать заново нельзя. Уже сделанная ссылка на неё остаётся в силе.
        if (object.list.deletionMark) conditions.push({ field: 'deletedAt', operator: 'null', value: true });
        // Справочник ищется по наименованию, документ по номеру: это части их представлений.
        if (searched !== '') conditions.push({ field: object.kind === 'document' ? 'number' : 'name', operator: 'contains', value: searched });
        return conditions;
    }, [object, searched]);

    const { result, query } = useList<RecordData, ApiError>({
        resource: resourceName(object),
        filters,
        sorters: object.list.defaultSort.map(crudSort),
        pagination: { currentPage: 1, pageSize: suggestionCount },
        // Пока список закрыт, записи не нужны: форма с десятком ссылок не должна отправлять десяток запросов при открытии.
        queryOptions: { enabled: open },
    });
    const options = useMemo(
        () => result.data.map((record) => ({ value: recordGuid(record), label: recordPresentation(object, record) })),
        [object, result.data],
    );
    const selected = useReferencePresentation(object, value ?? null);

    return (
        <Select<string>
            ref={inner}
            {...defined({ id, disabled })}
            style={{ width: '100%' }}
            // Отбирает записи сервер, поэтому собственный отбор списка по введённому тексту отключён.
            showSearch={{ filterOption: false, onSearch: setSearch }}
            allowClear={field.rules?.required !== true}
            placeholder="Начните вводить для поиска"
            open={open}
            onOpenChange={(opened) => {
                setOpen(opened);
                if (!opened) setSearch('');
            }}
            options={options}
            loading={query.isFetching}
            notFoundContent={query.isFetching ? 'Загрузка…' : 'Ничего не найдено'}
            value={value ?? null}
            // Выбранной записи может не быть среди предложенных: она дальше первых записей списка
            // или помечена на удаление. Поэтому её представление читается отдельно, а подпись
            // из предложенных записей используется, пока оно не прочитано.
            labelRender={(option) => (selected.loaded ? selected.text : (option.label ?? selected.text))}
            onChange={(guid: string | undefined) => onChange?.(guid ?? null)}
        />
    );
}
