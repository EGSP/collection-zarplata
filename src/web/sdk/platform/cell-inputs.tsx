/**
 * Поля ячейки табличной части, которым нужен список: подсказки значений, выбор из вариантов,
 * ссылка на запись, составное значение, дата и дата со временем. Все они построены на `CellComboInput` дизайн-системы: в ячейке стоит
 * собственный `input` без рамки и отступов Ant Design, а варианты выводятся списком под ячейкой.
 * Данные для списков (записи-подсказки, найденные записи, представление ссылки) этот модуль
 * берёт у платформы.
 *
 * Значение каждое поле отдаёт в формате сервера, как виджеты реестра: число, `guid` записи,
 * дата строкой `YYYY-MM-DD`. Наружу у всех одинаковое управление фокусом (`CellTextInputHandle`).
 */
import { useList, type CrudFilter } from '@refinedev/core';
import { Calendar } from 'antd';
import dayjs from 'dayjs';
import { useContext, useMemo, useState, type ComponentType, type Ref } from 'react';
import { compositeReference } from '../../../server/metadata/composite';
import type { CompositeValue } from '../../../server/metadata/descriptions';
import type { FormField, ObjectView } from '../../../server/ui/descriptions';
import type { ReferencePresentations } from '../../../server/ui/reference-presentation';
import type { ApiError } from '../../common/api';
import { useDebounced } from '../../common/debounced';
import { crudSort, searchFilters } from '../../data-provider/data-provider';
import { findObjectView, useMetadata, useObjectView } from '../../data-provider/metadata';
import { resourceName } from '../../data-provider/perform';
import type { RecordData } from '../../data-provider/records';
import { LookupDialog } from '../../references/lookup-dialog';
import { listRecordPresentation, useObjectReferencePresentation, useReferencePresentation } from '../../references/presentation';
import { useRecordSuggestions } from '../../references/record-suggestions';
import { compositeTypeTitle, defaultInterpretation, displayedText, editableText, textInterpretations } from '../../widgets/composite-text';
import { Button } from '../ds/button';
import { CellComboInput } from '../ds/cell-combo';
import { cellTextRules, formatCell, type CellTextInputHandle, type PrimitiveCellType } from '../ds/cell-types';
import { Icons } from '../ds/icons';
import { Text } from '../ds/text';
import { RecordDialogContext } from './open-record';

/** Свойства поля ячейки. `value` и `onChange` передаёт `Form.Item` через ячейку. */
export interface CellInputProperties {
    readonly field: FormField;
    readonly value?: unknown;
    readonly onChange?: ((value: unknown) => void) | undefined;
    readonly id?: string | undefined;
    readonly ref?: Ref<CellTextInputHandle> | undefined;
}

/**
 * Поле ячейки со списком для поля либо `null`, если списка у поля нет: тогда ячейка ставит
 * простое поле типа или виджет реестра.
 */
export function listCellInput(field: FormField): ComponentType<CellInputProperties> | null {
    if (field.suggestions != null && (field.kind === 'number' || field.kind === 'money')) return SuggestionCellInput;
    if (field.kind === 'string' && field.choices != null) return ChoiceCellInput;
    if (field.kind === 'reference' && field.target !== null) return ReferenceCellInput;
    if (field.kind === 'date') return DateCellInput;
    if (field.kind === 'dateTime') return DateTimeCellInput;
    // Составное значение со способом `solid` (дата или флажок среди вариантов) текстом не набрать:
    // его вводит виджет реестра.
    if (field.kind === 'composite' && field.inputMode === 'fluent') return CompositeCellInput;
    return null;
}

/** Задержка поиска подсказок после ввода, как у остальных полей с поиском. */
const searchDelay = 300;

/**
 * Число или сумма с подсказками из записей другого объекта, например скидка из справочника скидок.
 * Набранное число остаётся значением; выбор подсказки ставит её число. Enter без выделенной
 * подсказки не выбирает первую: иначе вместо набранного числа сохранилось бы чужое.
 */
function SuggestionCellInput({ field, value, onChange, id, ref }: CellInputProperties) {
    const source = field.suggestions!;
    const type = field.kind as PrimitiveCellType;
    const rules = cellTextRules(type, { integer: field.rules.integer });
    const object = useObjectView(source.target);
    const [search, setSearch] = useState('');
    const searched = useDebounced(search, searchDelay);
    const conditions: CrudFilter[] = [
        { field: 'deletedAt', operator: 'null', value: true },
        { field: source.field, operator: 'nnull', value: true },
        ...searchFilters(searched),
    ];
    const { result, query } = useList<RecordData, ApiError>({
        resource: resourceName(source.target), filters: conditions,
        sorters: object?.list.defaultSort.map(crudSort) ?? [],
        pagination: { currentPage: 1, pageSize: 50 },
        queryOptions: { enabled: object !== undefined },
        errorNotification: false,
    });
    const presentations = result['presentations'] as ReferencePresentations | undefined;
    const records = result.data.filter((record) => typeof record[source.field] === 'number');
    return (
        <CellComboInput
            ref={ref}
            {...(id === undefined ? {} : { id })}
            label={field.title}
            text={rules.format(value)}
            accepts={(text) => rules.accepts(text.replace(/\s/gu, ''))}
            inputMode={rules.inputMode}
            loading={query.isFetching}
            emptyText={object === undefined ? 'Нет доступа' : 'Ничего не найдено'}
            options={object === undefined ? [] : records.map((record) => ({
                key: String(record['guid']),
                label: `${listRecordPresentation(object, record, presentations)} · ${formatCell(type, record[source.field])}`,
            }))}
            onText={(text) => {
                setSearch(text);
                const parsed = rules.parse(text.replace(/\s/gu, ''));
                if (parsed !== undefined) onChange?.(parsed);
            }}
            onPick={(guid) => {
                const number = records.find((record) => record['guid'] === guid)?.[source.field];
                if (typeof number !== 'number') return undefined;
                onChange?.(number);
                return rules.format(number);
            }}
        />
    );
}

/**
 * Строка с выбором из вариантов. Набранный текст отбирает варианты, а значением становится только
 * выбранный вариант: свободный текст в такое поле не записывается. Стёртый текст очищает значение.
 */
function ChoiceCellInput({ field, value, onChange, id, ref }: CellInputProperties) {
    const [search, setSearch] = useState('');
    const needle = search.trim().toLocaleLowerCase('ru');
    const choices = (field.choices ?? []).filter((choice) => choice.toLocaleLowerCase('ru').includes(needle));
    return (
        <CellComboInput
            ref={ref}
            {...(id === undefined ? {} : { id })}
            label={field.title}
            text={typeof value === 'string' ? value : ''}
            autoHighlight
            options={choices.map((choice) => ({ key: choice, label: choice }))}
            onText={(text) => {
                setSearch(text);
                if (text === '') onChange?.(null);
            }}
            onPick={(choice) => {
                onChange?.(choice);
                return choice;
            }}
        />
    );
}

/**
 * Ссылка на запись: текст служит поиском, список предлагает найденные записи, а значением
 * становится `guid` выбранной. Если у объекта объявлен подбор, справа в ячейке стоит кнопка подбора:
 * она открывает окно с поиском и таблицей. Стёртый текст очищает ссылку.
 */
function ReferenceCellInput(properties: CellInputProperties) {
    const object = useObjectView(properties.field.target);
    // Без права читать целевой объект выбрать запись нельзя: поле показывает «Нет доступа».
    if (object === undefined) return <CellComboInput text="Нет доступа" label={properties.field.title} accepts={() => false} />;
    return <ReferenceCombo {...properties} object={object} />;
}

function ReferenceCombo({ field, value, onChange, id, ref, object }: CellInputProperties & { readonly object: ObjectView }) {
    const guid = typeof value === 'string' ? value : null;
    const presentation = useReferencePresentation(object, guid);
    const [search, setSearch] = useState('');
    const [searching, setSearching] = useState(false);
    const [lookingUp, setLookingUp] = useState(false);
    // Выбор в окне подбора меняет значение снаружи поля: новый ключ заново ставит в поле его представление.
    const [version, setVersion] = useState(0);
    const { groups, loading } = useRecordSuggestions([object], search, searching);
    const suggestions = groups[0]?.suggestions ?? [];
    return (
        <>
            <CellComboInput
                key={version}
                ref={ref}
                {...(id === undefined ? {} : { id })}
                label={field.title}
                placeholder="Начните вводить для поиска"
                text={presentation.text}
                autoHighlight
                loading={loading}
                options={suggestions.map((suggestion) => ({ key: suggestion.reference.guid, label: suggestion.label }))}
                onText={(text) => {
                    setSearching(true);
                    setSearch(text);
                    if (text === '') onChange?.(null);
                }}
                onPick={(picked) => {
                    onChange?.(picked);
                    return suggestions.find((suggestion) => suggestion.reference.guid === picked)?.label;
                }}
                {...(object.lookup === null ? {} : {
                    trailing: () => <Button type="text" icon={<Icons.lookup />} aria-label="Подбор" onClick={() => setLookingUp(true)} />,
                })}
            />
            {lookingUp && (
                <LookupDialog
                    object={object}
                    value={guid}
                    onSelect={(picked) => {
                        onChange?.(picked);
                        setVersion((current) => current + 1);
                    }}
                    onClose={() => setLookingUp(false)}
                />
            )}
        </>
    );
}

/** Вариант списка составного значения: что он делает при выборе и его подпись. */
interface CompositeOption {
    readonly key: string;
    readonly label: string;
    /** Источник варианта: «Строка», заголовок справочника, «Создать». Подписывается, когда источников несколько. */
    readonly source: string;
    /** Значение, которое ставит выбор, либо объект, запись которого выбор создаёт в окне. */
    readonly action: { readonly value: CompositeValue } | { readonly create: ObjectView };
}

/**
 * Составное значение, которое вводится текстом (способ `fluent`), например «Куда оплачено»:
 * строка либо приёмник оплат из справочника. Правила те же, что у поля формы
 * (`CompositeFluentInput`), но поле собственное, без рамки и отступов Ant Design.
 *
 * Набранный текст становится значением простого варианта: строкой, а без строкового варианта числом
 * или суммой. Список предлагает записи целевых объектов, значения из перечня строки и, когда текст
 * подходит нескольким вариантам, их толкования. Запись выбирается явно: Enter без выделения
 * оставляет набранный текст строкой, а не первую найденную запись. Если записей по тексту нет,
 * список предлагает создать её в модальном окне.
 *
 * Тип значения подписан справа в ячейке: строка «100» и число 100 выглядят одинаково.
 */
function CompositeCellInput({ field, value, onChange, id, ref }: CellInputProperties) {
    const metadata = useMetadata().data;
    const current = (value ?? null) as CompositeValue | null;
    const variants = useMemo(() => field.variants ?? [], [field.variants]);
    const [search, setSearch] = useState('');
    const [searching, setSearching] = useState(false);
    const targets = useMemo(() => variants.flatMap((variant): Array<ObjectView> => {
        const object = variant.kind === 'reference' ? findObjectView(metadata, variant.target) : undefined;
        return object === undefined ? [] : [object];
    }), [variants, metadata]);
    const records = useRecordSuggestions(targets, search, searching);

    const reference = compositeReference(current);
    const selected = useObjectReferencePresentation(reference);
    const text = current === null ? '' : reference === null ? editableText(current) : selected.text;

    const openDialog = useContext(RecordDialogContext);
    const entered = search.trim();
    const interpretations = textInterpretations(variants, search);
    const choices = variants.find((variant) => variant.kind === 'string')?.choices ?? [];
    const nothingFound = entered !== '' && !records.loading && records.groups.every((group) => group.suggestions.length === 0);
    const options: ReadonlyArray<CompositeOption> = [
        // Толкования предлагаются, только когда их несколько: единственное поле применяет само.
        ...(interpretations.length < 2 ? [] : interpretations.map((candidate): CompositeOption => ({
            key: `value/${candidate.type}`, source: 'Считать значением',
            label: `${compositeTypeTitle(metadata, candidate.type, null)}: ${displayedText(candidate)}`, action: { value: candidate },
        }))),
        ...choices.filter((choice) => choice.toLowerCase().includes(entered.toLowerCase())).map((choice): CompositeOption => ({
            key: `choice/${choice}`, source: 'Значения', label: choice, action: { value: { type: 'string', value: choice } },
        })),
        ...records.groups.flatMap((group) => group.suggestions.map((suggestion): CompositeOption => ({
            key: `record/${suggestion.key}`, source: group.object.title, label: suggestion.label, action: { value: { type: 'reference', ...suggestion.reference } },
        }))),
        // Создание записи: только когда записей по тексту нет, в объекты с правом записи и там,
        // где модальное окно можно показать.
        ...(openDialog === null || !nothingFound ? [] : targets
            .filter((object) => object.form?.actions.some((action) => action.name === 'save') === true)
            .map((object): CompositeOption => ({ key: `create/${object.kind}/${object.name}`, source: 'Создать', label: `Новый: ${object.title}`, action: { create: object } }))),
    ];
    // Источник подписывается, только когда их несколько: иначе неясно, что именно предложено.
    const labelled = new Set(options.map((option) => option.source)).size > 1;

    /**
     * Создаёт запись в окне и делает её значением. Справочнику, который называется своим
     * наименованием, введённый текст передаётся наименованием. Закрытое без записи окно
     * оставляет набранный текст значением.
     */
    const create = async (object: ObjectView, name: string) => {
        if (openDialog === null) return;
        const initial = object.kind === 'catalog' && object.presentation === null ? { name } : undefined;
        const guid = await openDialog(object, null, initial);
        if (guid !== null) onChange?.({ type: 'reference', kind: object.kind === 'document' ? 'document' : 'catalog', name: object.name, guid });
    };

    return (
        // Поле не пересоздаётся при смене значения: иначе после выбора записи из него ушёл бы фокус.
        // Текст выбранной записи ставит `onPick`, а представление прежней ссылки к началу
        // редактирования уже прочитано для просмотра ячейки.
        <CellComboInput
            ref={ref}
            {...(id === undefined ? {} : { id })}
            label={field.title}
            placeholder={variants.map((variant) => compositeTypeTitle(metadata, variant.kind, variant.target)).join(', ')}
            text={text}
            loading={records.loading}
            options={options.map((option) => ({
                key: option.key,
                label: labelled ? <>{option.label} <Text.Helper noWrap>· {option.source}</Text.Helper></> : option.label,
            }))}
            onText={(typed) => {
                setSearching(true);
                setSearch(typed);
                if (typed.trim() === '') {
                    onChange?.(null);
                    return;
                }
                // Текст, который не подходит ни одному простому варианту, служит только поиском записей:
                // прежнее значение остаётся, пока пользователь не выберет запись.
                const interpreted = defaultInterpretation(textInterpretations(variants, typed), current);
                if (interpreted !== undefined) onChange?.(interpreted);
            }}
            onPick={(key) => {
                const option = options.find((candidate) => candidate.key === key);
                if (option === undefined) return undefined;
                if ('create' in option.action) {
                    void create(option.action.create, entered);
                    return undefined;
                }
                onChange?.(option.action.value);
                return option.action.value.type === 'reference' ? option.label : editableText(option.action.value);
            }}
            trailing={() => current === null ? null : <Text.Helper noWrap>{compositeTypeTitle(metadata, current.type, reference)}</Text.Helper>}
        />
    );
}

/** Дата в поле: «дд.мм.гггг»; дата со временем: «дд.мм.гггг чч:мм». */
const dateText = /^(\d{2})\.(\d{2})\.(\d{4})$/u;
const dateTimeText = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/u;

/** Текст «дд.мм.гггг» в значение `YYYY-MM-DD`; несуществующая дата вроде 31.02 не принимается. */
function parseDate(text: string): string | null | undefined {
    if (text === '') return null;
    const match = dateText.exec(text);
    if (match === null) return undefined;
    const [, day, month, year] = match;
    const date = dayjs(`${year}-${month}-${day}`);
    return date.isValid() && date.format('DD.MM.YYYY') === text ? date.format('YYYY-MM-DD') : undefined;
}

/**
 * Дата: набирается текстом «дд.мм.гггг» и выбирается в календаре. Календарь открывают стрелка вниз
 * и кнопка справа в ячейке; при наборе он не открывается, чтобы Enter переходил к следующей ячейке.
 * Пока дата не набрана целиком, значение не меняется.
 */
function DateCellInput({ field, value, onChange, id, ref }: CellInputProperties) {
    const current = typeof value === 'string' ? value : null;
    return (
        <CellComboInput
            ref={ref}
            {...(id === undefined ? {} : { id })}
            label={field.title}
            placeholder="дд.мм.гггг"
            text={formatCell('date', current)}
            accepts={(text) => /^[\d.]{0,10}$/u.test(text)}
            inputMode="numeric"
            openOnType={false}
            onText={(text) => {
                const parsed = parseDate(text);
                if (parsed !== undefined) onChange?.(parsed);
            }}
            panel={(done) => (
                <Calendar
                    fullscreen={false}
                    {...(current === null ? {} : { value: dayjs(current) })}
                    onSelect={(date, { source }) => {
                        // Смена месяца или года в шапке календаря значение не выбирает.
                        if (source !== 'date') return;
                        onChange?.(date.format('YYYY-MM-DD'));
                        done(date.format('DD.MM.YYYY'));
                    }}
                />
            )}
            trailing={({ toggle }) => <Button type="text" icon={<Icons.calendar />} aria-label="Календарь" onClick={toggle} />}
        />
    );
}

/**
 * Текст «дд.мм.гггг чч:мм» в значение ISO 8601 в UTC: время пользователь видит по часовому
 * поясу браузера, а сервер требует пояс в значении, как у поля даты и времени на форме.
 */
function parseDateTime(text: string): string | null | undefined {
    if (text === '') return null;
    const match = dateTimeText.exec(text);
    if (match === null) return undefined;
    const [, day, month, year, hour, minute] = match;
    const date = dayjs(`${year}-${month}-${day}T${hour}:${minute}`);
    return date.isValid() && date.format('DD.MM.YYYY HH:mm') === text ? date.toISOString() : undefined;
}

/**
 * Дата и время: набираются текстом «дд.мм.гггг чч:мм», дата выбирается в календаре. Календарь
 * меняет только дату, а время остаётся прежним; у пустого значения время — текущее.
 */
function DateTimeCellInput({ field, value, onChange, id, ref }: CellInputProperties) {
    const current = typeof value === 'string' ? dayjs(value) : null;
    return (
        <CellComboInput
            ref={ref}
            {...(id === undefined ? {} : { id })}
            label={field.title}
            placeholder="дд.мм.гггг чч:мм"
            text={current === null ? '' : current.format('DD.MM.YYYY HH:mm')}
            accepts={(text) => /^[\d.: ]{0,16}$/u.test(text)}
            inputMode="numeric"
            openOnType={false}
            onText={(text) => {
                const parsed = parseDateTime(text);
                if (parsed !== undefined) onChange?.(parsed);
            }}
            panel={(done) => (
                <Calendar
                    fullscreen={false}
                    {...(current === null ? {} : { value: current })}
                    onSelect={(date, { source }) => {
                        if (source !== 'date') return;
                        const time = current ?? dayjs();
                        const chosen = date.hour(time.hour()).minute(time.minute()).second(0).millisecond(0);
                        onChange?.(chosen.toISOString());
                        done(chosen.format('DD.MM.YYYY HH:mm'));
                    }}
                />
            )}
            trailing={({ toggle }) => <Button type="text" icon={<Icons.calendar />} aria-label="Календарь" onClick={toggle} />}
        />
    );
}
