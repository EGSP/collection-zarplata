/**
 * Единое поле ввода составного значения (способ `fluent`): все варианты вводятся текстом в одном поле.
 *
 * Пользователь печатает, а поле показывает, чем введённое может быть: записью одного из целевых
 * объектов, значением из перечня строки, строкой, числом или суммой. Выбор подсказки задаёт
 * значение явно. Без выбора текст становится значением простого варианта: строкой, а если
 * строкового варианта нет, числом или суммой. Поэтому имя человека, которого нет в справочнике,
 * сохраняется строкой и не мешает вводу. Тип получившегося значения подписан под полем: «100»
 * строкой и числом выглядят одинаково, а сравниваются и суммируются по-разному.
 *
 * Если по тексту не нашлось ни одной записи, список предлагает создать её: пункт «Новый: <объект>»
 * для каждого ссылочного варианта. Пункт открывает форму новой записи в модальном окне, а записанная
 * там запись становится значением поля вместо строки.
 */
import { AutoComplete, Button, Flex, Tooltip, type AutoCompleteProps } from 'antd';
import { useContext, useMemo, useState } from 'react';
import { compositeReference } from '../../server/metadata/composite';
import type { CompositeValue } from '../../server/metadata/descriptions';
import type { ObjectView } from '../../server/ui/descriptions';
import { RecordNavigationLink } from '../references/reference-display';
import { findObjectView, useMetadata } from '../data-provider/metadata';
import { useObjectReferencePresentation } from '../references/presentation';
import { recordSuggestionKey, useRecordSuggestions } from '../references/record-suggestions';
import { Icons } from '../sdk/ds/icons';
import { Text } from '../sdk/ds/text';
import { RecordDialogContext } from '../sdk/platform/open-record';
import { compositeTypeTitle, defaultInterpretation, displayedText, editableText, textInterpretations } from './composite-text';
import { defined, useInputHandle } from './inputs';
import type { CompositeInputProperties } from './widget';

/** Название кнопки перехода к выбранной записи: подписи у кнопки нет, оно служит подсказкой и текстом для чтения с экрана. */
const openRecordTitle = 'Открыть запись';

/** Подсказка: значение, которое она подставляет, и текст пункта списка. */
interface Suggestion {
    readonly key: string;
    readonly value: CompositeValue;
    readonly label: string;
}

/**
 * Ключи подсказок начинаются с редкой последовательности: Ant Design сообщает о выборе пункта тем же
 * событием, что и о вводе, и ключ не должен совпасть с текстом, который пользователь может набрать.
 */
const keyPrefix = '⁣⁣';

/**
 * Поле ввода составного значения текстом. Значение остаётся в формате сервера, пустое поле отдаёт `null`.
 *
 * Пока пользователь печатает, поле хранит набранный текст отдельно от значения: текст «12,» ещё
 * не число 12,5, а текст, не подходящий ни одному варианту, значения не меняет. При потере
 * фокуса поле снова показывает само значение, поэтому несохранённый текст в нём не остаётся.
 *
 * Объекты, которые пользователь не вправе читать, подсказок не дают: сервер не отдаёт их описаний.
 * Ссылка на запись такого объекта показана текстом «Нет доступа».
 */
export function CompositeFluentInput({ field, value, onChange, disabled, id, ref }: CompositeInputProperties) {
    const inner = useInputHandle(ref);
    const metadata = useMetadata().data;
    const variants = useMemo(() => field.variants ?? [], [field.variants]);
    const [open, setOpen] = useState(false);
    // Текст, который пользователь набирает сейчас; null означает, что поле показывает значение.
    const [draft, setDraft] = useState<string | null>(null);
    // Подпись выбранной записи показывается, пока её представление читается отдельным запросом.
    const [picked, setPicked] = useState<Suggestion | null>(null);

    const targets = useMemo(() => variants.flatMap((variant): Array<ObjectView> => {
        const object = variant.kind === 'reference' ? findObjectView(metadata, variant.target) : undefined;
        return object === undefined ? [] : [object];
    }), [variants, metadata]);
    const records = useRecordSuggestions(targets, draft ?? '', open);

    const interpretations = useMemo(() => textInterpretations(variants, draft ?? ''), [variants, draft]);
    const groups = useMemo(() => {
        const entered = (draft ?? '').trim().toLowerCase();
        const choices = variants.find((variant) => variant.kind === 'string')?.choices ?? [];
        return [
            // Толкования предлагаются, только когда их несколько: единственное поле применяет само.
            {
                title: 'Считать значением',
                suggestions: interpretations.length < 2 ? [] : interpretations.map((candidate): Suggestion => ({
                    key: `${keyPrefix}value/${candidate.type}`,
                    value: candidate,
                    label: `${compositeTypeTitle(metadata, candidate.type, null)}: ${displayedText(candidate)}`,
                })),
            },
            {
                title: 'Значения',
                suggestions: choices.filter((choice) => choice.toLowerCase().includes(entered)).map((choice): Suggestion => ({
                    key: `${keyPrefix}choice/${choice}`, value: { type: 'string', value: choice }, label: choice,
                })),
            },
            ...records.groups.map((group) => ({
                title: group.object.title,
                suggestions: group.suggestions.map((suggestion): Suggestion => ({
                    key: `${keyPrefix}record/${suggestion.key}`, value: { type: 'reference', ...suggestion.reference }, label: suggestion.label,
                })),
            })),
        ].filter((group) => group.suggestions.length > 0);
    }, [variants, draft, interpretations, records.groups, metadata]);
    const suggestions = groups.flatMap((group) => group.suggestions);

    // Создание записи из поля: только когда записей по тексту нет, в объекты с правом записи
    // и там, где модальное окно можно показать.
    const openDialog = useContext(RecordDialogContext);
    const entered = (draft ?? '').trim();
    const nothingFound = entered !== '' && !records.loading && records.groups.every((group) => group.suggestions.length === 0);
    const creations = openDialog === null || !nothingFound ? [] : targets
        .filter((object) => object.form?.actions.some((action) => action.name === 'save') === true)
        .map((object) => ({ key: `${keyPrefix}create/${object.kind}/${object.name}`, object, label: `Новый: ${object.title}` }));

    /**
     * Создаёт запись в окне и делает её значением поля. Справочнику, который называется своим
     * наименованием, введённый текст передаётся наименованием. Закрытое без записи окно
     * оставляет прежнее значение: введённый текст строкой, если строковый вариант есть.
     */
    const create = async (object: ObjectView, name: string) => {
        if (openDialog === null) return;
        const initial = object.kind === 'catalog' && object.presentation === null ? { name } : undefined;
        const guid = await openDialog(object, null, initial);
        if (guid === null) return;
        const created: CompositeValue = { type: 'reference', kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, guid };
        // Пока представление новой записи читается, поле показывает введённый текст.
        setPicked({ key: `${keyPrefix}record/${recordSuggestionKey({ kind: created.kind, name: created.name, guid })}`, value: created, label: name });
        onChange?.(created);
    };

    const toOption = (suggestion: Pick<Suggestion, 'key' | 'label'>) => ({ value: suggestion.key, label: suggestion.label });
    const shownGroups = [...groups, ...(creations.length === 0 ? [] : [{ title: 'Создать', suggestions: creations }])];
    // Заголовки нужны, только когда источников несколько: иначе неясно, что именно предложено.
    const options: NonNullable<AutoCompleteProps['options']> = shownGroups.length === 1
        ? shownGroups[0]!.suggestions.map(toOption)
        : shownGroups.map((group) => ({ label: group.title, options: group.suggestions.map(toOption) }));

    const reference = compositeReference(value);
    const selected = useObjectReferencePresentation(reference);
    const referenceObject = findObjectView(metadata, reference);
    const shown = value === null || value === undefined ? ''
        : reference === null ? editableText(value)
        : !selected.loaded && picked !== null && picked.key.endsWith(recordSuggestionKey(reference)) ? picked.label
        : selected.text;

    return (
        <Flex vertical gap={2} data-picker-open={open}>
            <Flex gap="small" align="center">
                <div style={{ flex: 1, minWidth: 0 }}>
                    <AutoComplete
                        ref={inner}
                        {...defined({ id, disabled })}
                        style={{ width: '100%' }}
                        allowClear={field.rules?.required !== true}
                        placeholder={variants.map((variant) => compositeTypeTitle(metadata, variant.kind, variant.target)).join(', ')}
                        value={draft ?? shown}
                        open={open}
                        onOpenChange={setOpen}
                        options={options}
                        notFoundContent={records.loading ? 'Загрузка…' : null}
                        // Enter не должен молча заменять набранный текст первой подсказкой: запись
                        // выбирается явно, стрелками или мышью, иначе текст остаётся значением.
                        defaultActiveFirstOption={false}
                        onBlur={() => {
                            setDraft(null);
                            // Ant Design не всегда закрывает управляемый список при уходе фокуса клавишей Tab.
                            setOpen(false);
                        }}
                        onChange={(entered: string | undefined) => {
                            const creation = creations.find((candidate) => candidate.key === entered);
                            if (creation !== undefined) {
                                // Текст запоминается до закрытия списка: уход фокуса в окно сбросит набранное.
                                const name = (draft ?? '').trim();
                                setDraft(null);
                                setOpen(false);
                                void create(creation.object, name);
                                return;
                            }
                            const suggestion = suggestions.find((candidate) => candidate.key === entered);
                            if (suggestion !== undefined) {
                                setPicked(suggestion);
                                setDraft(null);
                                onChange?.(suggestion.value);
                                return;
                            }
                            const text = entered ?? '';
                            if (text === '') {
                                setDraft(null);
                                onChange?.(null);
                                return;
                            }
                            setDraft(text);
                            const interpreted = defaultInterpretation(textInterpretations(variants, text), value);
                            // Текст, который не подходит ни одному простому варианту, служит только запросом
                            // подсказок: прежнее значение остаётся, пока пользователь не выберет запись.
                            if (interpreted !== undefined) onChange?.(interpreted);
                        }}
                    />
                </div>
                {reference !== null && referenceObject !== undefined && (
                    <Tooltip title={openRecordTitle}>
                        <RecordNavigationLink object={referenceObject} guid={reference.guid}><Button icon={<Icons.open />} aria-label={openRecordTitle} /></RecordNavigationLink>
                    </Tooltip>
                )}
            </Flex>
            {value !== null && value !== undefined && (
                <Text.Helper>{compositeTypeTitle(metadata, value.type, reference)}</Text.Helper>
            )}
        </Flex>
    );
}
