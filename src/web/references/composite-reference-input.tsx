/**
 * Единый ввод составного поля, варианты которого — строка и ссылки: «выбрать запись либо вписать текст».
 *
 * Пользователь печатает в одном поле. Введённый текст сразу становится строковым значением
 * и одновременно служит запросом подсказок: поле предлагает записи целевых объектов, найденные
 * по представлению. Выбор подсказки заменяет строку ссылкой. Отдельного переключателя типа нет:
 * он заставил бы решать, строка это или ссылка, до того как видно, есть ли подходящая запись.
 */
import { useQuery } from '@tanstack/react-query';
import { AutoComplete, Button, Flex, Tooltip, type AutoCompleteProps } from 'antd';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { compositeReference } from '../../server/metadata/composite';
import type { CompositeValue, ObjectReferenceValue } from '../../server/metadata/descriptions';
import type { ObjectView } from '../../server/ui/descriptions';
import type { ReferencePresentations } from '../../server/ui/reference-presentation';
import { recordPath } from '../common/paths';
import { useDebounced } from '../common/debounced';
import { findObjectView, useMetadata } from '../data-provider/metadata';
import { performBatch, resourceName } from '../data-provider/perform';
import { recordGuid, type RecordData } from '../data-provider/records';
import { Icons } from '../sdk/icons';
import { defined, useInputHandle } from '../widgets/inputs';
import type { InputProperties } from '../widgets/widget';
import { listRecordPresentation, useObjectReferencePresentation } from './presentation';

/** Сколько записей каждого целевого объекта поле предлагает на выбор. Остальные находятся уточнением текста. */
const suggestionCount = 20;

/** Задержка поиска после ввода, в миллисекундах: запрос уходит, когда пользователь перестал печатать. */
const searchDelay = 300;

/** Название кнопки перехода к выбранной записи: подписи у кнопки нет, оно служит подсказкой и текстом для чтения с экрана. */
const openRecordTitle = 'Открыть запись';

/** Страница действия `list` в том виде, в каком её отдаёт сервер. */
interface SuggestionPage {
    readonly items: ReadonlyArray<RecordData>;
    readonly presentations: ReferencePresentations;
}

/** Подсказка: ссылка, которую она подставляет, и текст, которым запись показана. */
interface Suggestion {
    readonly key: string;
    readonly reference: ObjectReferenceValue;
    readonly label: string;
}

/** Ключ подсказки. Он же значение пункта списка: по нему выбор отличается от введённого текста. */
function suggestionKey(reference: ObjectReferenceValue): string {
    return `${reference.kind}/${reference.name}/${reference.guid}`;
}

/**
 * Поле ввода значения «строка либо ссылка». Значение остаётся в формате сервера: `{ type: 'string', value }`
 * или `{ type: 'reference', kind, name, guid }`, пустое поле отдаёт `null`.
 *
 * Объекты, которые пользователь не вправе читать, подсказок не дают: сервер не отдаёт их описаний.
 * Ссылка на запись такого объекта показана текстом «Нет доступа»; её можно заменить строкой
 * или другой ссылкой.
 */
export function CompositeReferenceInput({ field, value, onChange, disabled, id, ref }: InputProperties<CompositeValue>) {
    const inner = useInputHandle(ref);
    const metadata = useMetadata().data;
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const searched = useDebounced(search, searchDelay);
    // Подпись выбранной подсказки показывается, пока представление записи читается отдельным запросом.
    const [picked, setPicked] = useState<Suggestion | null>(null);

    const targets = useMemo(
        () => (field.variants ?? []).flatMap((variant): Array<ObjectView> => {
            const object = variant.kind === 'reference' ? findObjectView(metadata, variant.target) : undefined;
            return object === undefined ? [] : [object];
        }),
        [field.variants, metadata],
    );
    const resources = targets.map(resourceName);
    const { data: pages, isFetching } = useQuery({
        queryKey: ['compositeSuggestions', resources, searched],
        // Подсказки всех целей читаются одним пакетом: число запросов не растёт с числом ссылочных вариантов.
        queryFn: () => performBatch<SuggestionPage>(targets.map((object) => ({
            target: { kind: object.kind, name: object.name },
            action: 'list',
            payload: {
                // Помеченную на удаление запись выбрать заново нельзя. Уже сделанная ссылка на неё остаётся в силе.
                filter: object.list.deletionMark ? [{ field: 'deletedAt', operator: 'equals', value: null }] : [],
                sort: object.list.defaultSort,
                ...(searched === '' ? {} : { presentation: searched }),
                page: 1,
                pageSize: suggestionCount,
            },
        }))),
        // Пока список закрыт, записи не нужны; при каждом открытии они читаются заново и не отстают от базы.
        enabled: open && targets.length > 0,
        staleTime: 0,
    });

    const groups = useMemo(() => targets.map((object, index) => ({
        object,
        suggestions: (pages?.[index]?.items ?? []).map((record): Suggestion => {
            const reference: ObjectReferenceValue = { kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, guid: recordGuid(record) };
            return { key: suggestionKey(reference), reference, label: listRecordPresentation(object, record, pages?.[index]?.presentations) };
        }),
    })), [targets, pages]);
    const suggestions = groups.flatMap((group) => group.suggestions);
    const toOption = (suggestion: Suggestion) => ({ value: suggestion.key, label: suggestion.label });
    // Заголовки групп нужны, только когда целей несколько: иначе неясно, записи какого объекта предложены.
    const options: NonNullable<AutoCompleteProps['options']> = groups.length === 1
        ? groups[0]!.suggestions.map(toOption)
        : groups.filter((group) => group.suggestions.length > 0).map((group) => ({ label: group.object.title, options: group.suggestions.map(toOption) }));

    const reference = compositeReference(value);
    const selected = useObjectReferencePresentation(reference);
    const referenceObject = findObjectView(metadata, reference);
    const text = value === null || value === undefined ? ''
        : value.type === 'string' ? value.value
        : reference === null ? ''
        : !selected.loaded && picked !== null && picked.key === suggestionKey(reference) ? picked.label
        : selected.text;

    return (
        <Flex gap="small" align="center" data-picker-open={open}>
            <div style={{ flex: 1, minWidth: 0 }}>
                <AutoComplete
                    ref={inner}
                    {...defined({ id, disabled })}
                    style={{ width: '100%' }}
                    allowClear={field.rules?.required !== true}
                    placeholder="Введите текст или выберите запись"
                    value={text}
                    open={open}
                    onOpenChange={(opened) => {
                        setOpen(opened);
                        if (!opened) setSearch('');
                    }}
                    options={options}
                    onSearch={setSearch}
                    notFoundContent={isFetching ? 'Загрузка…' : null}
                    onChange={(entered: string | undefined) => {
                        // Ant Design сообщает о выборе пункта тем же событием, что и о вводе, передавая значение пункта.
                        const suggestion = suggestions.find((candidate) => candidate.key === entered);
                        if (suggestion !== undefined) {
                            setPicked(suggestion);
                            onChange?.({ type: 'reference', ...suggestion.reference });
                        } else onChange?.(entered === undefined || entered === '' ? null : { type: 'string', value: entered });
                    }}
                />
            </div>
            {reference !== null && referenceObject !== undefined && (
                <Tooltip title={openRecordTitle}>
                    <Link to={recordPath(referenceObject, reference.guid)}><Button icon={<Icons.open />} aria-label={openRecordTitle} /></Link>
                </Tooltip>
            )}
        </Flex>
    );
}
