import { Button, Flex, Input, Select, Tooltip, Typography } from 'antd';
import { RecordNavigationLink } from './reference-display';
import { useContext, useMemo, useState } from 'react';
import type { ObjectView } from '../../server/ui/descriptions';
import { useObjectView } from '../data-provider/metadata';
import { Icons } from '../sdk/ds/icons';
import { RecordDialogContext } from '../sdk/platform/open-record';
import { defined, useInputHandle } from '../widgets/inputs';
import type { FieldValues, InputProperties } from '../widgets/widget';
import { noAccessText, useReferencePresentation } from './presentation';
import { LookupDialog } from './lookup-dialog';
import { useRecordSuggestions } from './record-suggestions';

/** Название кнопки перехода к выбранной записи: подписи у кнопки нет, оно служит подсказкой и текстом для чтения с экрана. */
const openRecordTitle = 'Открыть запись';

/** Название кнопки подбора: подписи у кнопки нет, как и у кнопки перехода к записи. */
const lookupTitle = 'Подбор';

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
 *
 * Если по введённому тексту ничего не найдено, список предлагает кнопку «Новый»: она открывает
 * форму новой записи в модальном окне, а записанная там запись сразу становится значением поля.
 * Справочнику, который называется своим наименованием, введённый текст передаётся наименованием
 * новой записи. Кнопки нет без права записи объекта и вне области окна, где окно не показать.
 *
 * Если целевой объект объявил подбор, рядом со списком стоит кнопка с лупой. Она открывает окно
 * подбора с поиском и таблицей, а выбранная там запись становится значением поля. У недоступного
 * для изменения поля кнопки нет: выбрать другую запись в нём нельзя.
 */
export function ReferenceInput(properties: InputProperties<FieldValues['reference']>) {
    const object = useObjectView(properties.field.target);
    const inner = useInputHandle(object === undefined ? properties.ref : undefined);
    const [lookingUp, setLookingUp] = useState(false);
    if (object === undefined) return <Input ref={inner} {...defined({ id: properties.id })} disabled value={noAccessText} />;
    return (
        <Flex gap="small" align="center">
            <div style={{ flex: 1, minWidth: 0 }}><ReferenceSelect {...properties} object={object} /></div>
            {object.lookup !== null && properties.disabled !== true && (
                <Tooltip title={lookupTitle}>
                    <Button icon={<Icons.lookup />} aria-label={lookupTitle} onClick={() => setLookingUp(true)} />
                </Tooltip>
            )}
            {lookingUp && (
                <LookupDialog object={object} value={properties.value ?? null} onSelect={(guid) => properties.onChange?.(guid)} onClose={() => setLookingUp(false)} />
            )}
            {properties.value != null && (
                <Tooltip title={openRecordTitle}>
                    <RecordNavigationLink object={object} guid={properties.value}><Button icon={<Icons.open />} aria-label={openRecordTitle} /></RecordNavigationLink>
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
    const openDialog = useContext(RecordDialogContext);
    const text = search.trim();
    const creatable = openDialog !== null && object.form?.actions.some((action) => action.name === 'save') === true;

    /** Создаёт запись в окне и выбирает её. Закрытое без записи окно значение поля не меняет. */
    const create = async () => {
        if (openDialog === null) return;
        setOpen(false);
        setSearch('');
        // Наименование подставляется, только если запись называется им: у справочника с представлением
        // по ссылке пользователь искал не наименование, и подставленное было бы неверным.
        const initial = object.kind === 'catalog' && object.presentation === null && text !== '' ? { name: text } : undefined;
        const guid = await openDialog(object, null, initial);
        if (guid !== null) onChange?.(guid);
    };
    const notFound = loading ? 'Загрузка…' : creatable && text !== '' ? (
        <Flex justify="space-between" align="center" gap="small">
            <Typography.Text type="secondary">Ничего не найдено</Typography.Text>
            <Button size="small" icon={<Icons.add />} onClick={() => void create()}>Новый</Button>
        </Flex>
    ) : 'Ничего не найдено';

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
            notFoundContent={notFound}
            value={value ?? null}
            // Выбранной записи может не быть среди предложенных: она дальше первых записей списка
            // или помечена на удаление. Поэтому её представление читается отдельно, а подпись
            // из предложенных записей используется, пока оно не прочитано.
            labelRender={(option) => (selected.loaded ? selected.text : (option.label ?? selected.text))}
            onChange={(guid: string | undefined) => onChange?.(guid ?? null)}
        />
    );
}
