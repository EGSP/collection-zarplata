/**
 * Реестр виджетов: для каждого вида поля компонент ввода и компонент отображения.
 *
 * Формы и списки строятся по описаниям с сервера и о видах полей сами ничего не знают: компонент
 * для поля они берут из реестра. Реестр обязан перечислить все виды полей, и это проверяется
 * типами. Если на сервере появится новый вид поля, клиент не соберётся, пока для него
 * не добавлена пара компонентов.
 */
import { ValueSuggestionInput } from './value-suggestions';
import { Flex, Select } from 'antd';
import { useState, type ComponentType } from 'react';
import { compositeVariant } from '../../server/metadata/composite';
import type { CompositeType, CompositeValue } from '../../server/metadata/descriptions';
import type { FieldKind } from '../../server/ui/descriptions';
import { useMetadata, findObjectView } from '../data-provider/metadata';
import { CompositeReferenceInput } from '../references/composite-reference-input';
import { noAccessText } from '../references/presentation';
import { ObjectReferenceDisplay, RecordLink, RecorderDisplay, ReferenceDisplay } from '../references/reference-display';
import { ObjectReferenceInput } from '../references/object-reference-input';
import { ReferenceInput } from '../references/reference-input';
import { BooleanDisplay, DateDisplay, DateTimeDisplay, MoneyDisplay, NumberDisplay, TextDisplay } from './displays';
import { BooleanInput, DateInput, DateTimeInput, MoneyInput, NumberInput, StringInput, defined, useInputHandle } from './inputs';
import type { DisplayProperties, FieldValues, InputProperties, Widget, WidgetField } from './widget';

/** Пары компонентов по видам полей. */
export const widgets: { readonly [Kind in FieldKind]: Widget<FieldValues[Kind]> } = {
    string: { input: StringInput, display: TextDisplay },
    number: { input: NumberInput, display: NumberDisplay },
    money: { input: MoneyInput, display: MoneyDisplay },
    date: { input: DateInput, display: DateDisplay },
    dateTime: { input: DateTimeInput, display: DateTimeDisplay },
    boolean: { input: BooleanInput, display: BooleanDisplay },
    reference: { input: ReferenceInput, display: ReferenceDisplay },
    objectReference: { input: ObjectReferenceInput, display: ObjectReferenceDisplay },
    composite: { input: CompositeInput, display: CompositeDisplay },
    guid: { input: null, display: TextDisplay },
    recorder: { input: null, display: RecorderDisplay },
};

/** Есть ли у поля компонент ввода. Его нет у видов, значения которых заполняет платформа. */
export function hasInput(field: WidgetField): boolean {
    return widgets[field.kind].input !== null;
}

/**
 * Поле ввода для поля любого вида. Значение приходит из записи или из формы без типа, а его
 * соответствие виду поля обеспечивает сервер: он отдаёт значения по тем же метаданным, что
 * и описание поля. Для вида без компонента ввода ничего не выводится.
 */
export function FieldInput(properties: InputProperties<unknown>) {
    if (properties.field.suggestions != null) return <ValueSuggestionInput {...properties as InputProperties<number>} />;
    const Input = widgets[properties.field.kind].input as ComponentType<InputProperties<unknown>> | null;
    return Input === null ? null : <Input {...properties} />;
}

/** Отображение значения поля любого вида. О типе значения см. `FieldInput`. */
export function FieldDisplay(properties: DisplayProperties<unknown>) {
    const Display = widgets[properties.field.kind].display as ComponentType<DisplayProperties<unknown>>;
    return <Display {...properties} />;
}

/** Названия простых типов значения в выборе варианта. Ссылочный вариант называется заголовком своего объекта. */
const variantTitles: { readonly [Type in Exclude<CompositeType, 'reference'>]: string } = {
    string: 'Строка',
    number: 'Число',
    money: 'Сумма',
    date: 'Дата',
    dateTime: 'Дата и время',
    boolean: 'Да или нет',
};

/**
 * Отображение составного значения виджетом его варианта: ссылка открывает запись и показана
 * её текущим представлением, простое значение выводится так же, как поле этого вида.
 */
function CompositeDisplay({ field, value }: DisplayProperties<CompositeValue>) {
    if (value === null || value === undefined) return null;
    if (value.type === 'reference') return <RecordLink reference={{ kind: value.kind, name: value.name, guid: value.guid }} />;
    // Вариант могли убрать из конфигурации; значение всё равно показывается по своему типу.
    return <FieldDisplay field={compositeVariant(field.variants, value) ?? { kind: value.type, target: null }} value={value.value} />;
}

/**
 * Поле ввода составного значения. Для строки со ссылками служит единый ввод с подсказками:
 * вариант определяется тем, выбрал пользователь запись или оставил текст. Остальные сочетания
 * вводятся выбором типа и полем ввода выбранного варианта.
 */
function CompositeInput(properties: InputProperties<CompositeValue>) {
    const variants = properties.field.variants ?? [];
    const scalar = variants.filter((variant) => variant.kind !== 'reference');
    // Строка с перечнем значений выбирается из списка, а не печатается, поэтому единый ввод ей не подходит.
    const text = scalar.length === 1 && scalar[0]!.kind === 'string' && scalar[0]!.choices == null;
    return text && scalar.length < variants.length ? <CompositeReferenceInput {...properties} /> : <CompositeVariantInput {...properties} />;
}

/** Выбор типа значения и поле ввода выбранного варианта. Смена типа очищает значение прежнего варианта. */
function CompositeVariantInput({ field, value, onChange, disabled, id, ref }: InputProperties<CompositeValue>) {
    const inner = useInputHandle(ref);
    const metadata = useMetadata().data;
    const variants = field.variants ?? [];
    // Тип, выбранный при пустом значении: само значение его ещё не хранит.
    const [chosen, setChosen] = useState<number | null>(null);
    const valueIndex = value === null || value === undefined ? -1 : variants.findIndex((variant) => compositeVariant([variant], value) !== undefined);
    const index = valueIndex >= 0 ? valueIndex : chosen;
    const variant = index === null ? undefined : variants[index];
    return (
        <Flex gap="small" align="center">
            <Select<number>
                ref={inner}
                {...defined({ id, disabled })}
                style={{ width: 150, flex: 'none' }}
                popupMatchSelectWidth={false}
                placeholder="Тип значения"
                allowClear={field.rules?.required !== true}
                value={index}
                options={variants.map((candidate, position) => ({
                    value: position,
                    label: candidate.kind === 'reference' ? findObjectView(metadata, candidate.target)?.title ?? noAccessText : variantTitles[candidate.kind as Exclude<CompositeType, 'reference'>],
                }))}
                onChange={(position: number | undefined) => {
                    setChosen(position ?? null);
                    // Флажок не бывает незаполненным: выбранный логический тип сразу означает «нет».
                    onChange?.(position !== undefined && variants[position]?.kind === 'boolean' ? { type: 'boolean', value: false } : null);
                }}
            />
            {variant !== undefined && (
                <div style={{ flex: 1, minWidth: 0 }}>
                    <FieldInput
                        field={variant}
                        value={value === null || value === undefined ? null : value.type === 'reference' ? value.guid : value.value}
                        disabled={disabled}
                        onChange={(entered) => {
                            // Очищенное поле варианта оставляет выбранный тип, чтобы пользователь продолжил ввод.
                            setChosen(index);
                            if (entered === null || entered === undefined) onChange?.(null);
                            else if (variant.kind === 'reference' && variant.target !== null) onChange?.({ type: 'reference', kind: variant.target.kind, name: variant.target.name, guid: entered as string });
                            else onChange?.({ type: variant.kind, value: entered } as CompositeValue);
                        }}
                    />
                </div>
            )}
        </Flex>
    );
}
