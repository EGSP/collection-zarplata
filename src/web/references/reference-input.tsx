import { Button, Flex, Input, Select, Tooltip } from 'antd';
import { Link } from 'react-router';
import { recordPath } from '../common/paths';
import { useMemo, useState } from 'react';
import type { ObjectView } from '../../server/ui/descriptions';
import { useObjectView } from '../data-provider/metadata';
import { Icons } from '../sdk/icons';
import { defined, useInputHandle } from '../widgets/inputs';
import type { FieldValues, InputProperties } from '../widgets/widget';
import { noAccessText, useReferencePresentation } from './presentation';
import { useRecordSuggestions } from './record-suggestions';

/** Название кнопки перехода к выбранной записи: подписи у кнопки нет, оно служит подсказкой и текстом для чтения с экрана. */
const openRecordTitle = 'Открыть запись';

/**
 * Поле ввода ссылки: выпадающий список с поиском по записям целевого объекта. Значением поля
 * служит `guid` выбранной записи, а пользователь видит её представление. Рядом с выбранной записью
 * стоит кнопка перехода к её форме.
 *
 * Если целевого объекта нет в описаниях, у пользователя нет права его читать. Тогда записи
 * не запрашиваются, вместо представления написано «Нет доступа», а выбрать другую запись нельзя.
 *
 * Справочник с представлением по ссылке предлагает записи под представлением целевых записей
 * и ищет введённый текст в нём же: наименование такой записи пользователь в поле не видит.
 */
export function ReferenceInput(properties: InputProperties<FieldValues['reference']>) {
    const object = useObjectView(properties.field.target);
    const inner = useInputHandle(object === undefined ? properties.ref : undefined);
    if (object === undefined) return <Input ref={inner} {...defined({ id: properties.id })} disabled value={noAccessText} />;
    return (
        <Flex gap="small" align="center">
            <div style={{ flex: 1, minWidth: 0 }}><ReferenceSelect {...properties} object={object} /></div>
            {properties.value != null && (
                <Tooltip title={openRecordTitle}>
                    <Link to={recordPath(object, properties.value)}><Button icon={<Icons.open />} aria-label={openRecordTitle} /></Link>
                </Tooltip>
            )}
        </Flex>
    );
}

function ReferenceSelect({ object, field, value, onChange, disabled, id, ref }: InputProperties<FieldValues['reference']> & { readonly object: ObjectView }) {
    const inner = useInputHandle(ref);
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    // Правила подсказок общие с составным полем: какие записи и каким запросом предлагать, решает хук.
    const objects = useMemo(() => [object], [object]);
    const { groups, loading } = useRecordSuggestions(objects, search, open);
    const options = useMemo(() => (groups[0]?.suggestions ?? []).map((suggestion) => ({ value: suggestion.reference.guid, label: suggestion.label })), [groups]);
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
            loading={loading}
            notFoundContent={loading ? 'Загрузка…' : 'Ничего не найдено'}
            value={value ?? null}
            // Выбранной записи может не быть среди предложенных: она дальше первых записей списка
            // или помечена на удаление. Поэтому её представление читается отдельно, а подпись
            // из предложенных записей используется, пока оно не прочитано.
            labelRender={(option) => (selected.loaded ? selected.text : (option.label ?? selected.text))}
            onChange={(guid: string | undefined) => onChange?.(guid ?? null)}
        />
    );
}
