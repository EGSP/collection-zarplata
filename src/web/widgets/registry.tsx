/**
 * Реестр виджетов: для каждого вида поля компонент ввода и компонент отображения.
 *
 * Формы и списки строятся по описаниям с сервера и о видах полей сами ничего не знают: компонент
 * для поля они берут из реестра. Реестр обязан перечислить все виды полей, и это проверяется
 * типами. Если на сервере появится новый вид поля, клиент не соберётся, пока для него
 * не добавлена пара компонентов.
 */
import { ValueSuggestionInput } from './value-suggestions';
import { Flex, Select, Typography } from 'antd';
import { useState, type ComponentType } from 'react';
import { compositeVariant } from '../../server/metadata/composite';
import type { CompositeValue } from '../../server/metadata/descriptions';
import type { FieldKind } from '../../server/ui/descriptions';
import { useMetadata } from '../data-provider/metadata';
import { ObjectReferenceDisplay, RecordLink, RecorderDisplay, ReferenceDisplay } from '../references/reference-display';
import { ObjectReferenceInput } from '../references/object-reference-input';
import { ReferenceInput } from '../references/reference-input';
import { BooleanDisplay, DateDisplay, DateTimeDisplay, MoneyDisplay, NumberDisplay, TextDisplay } from './displays';
import { BooleanInput, DateInput, DateTimeInput, MoneyInput, NumberInput, StringInput, defined, useInputHandle } from './inputs';
import { CompositeFluentInput } from './composite-fluent-input';
import { compositeTypeTitle } from './composite-text';
import type { CompositeInputModes, CompositeInputProperties, DisplayProperties, FieldValues, InputProperties, Widget, WidgetField } from './widget';

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

/**
 * Отображение составного значения виджетом его варианта: ссылка открывает запись и показана
 * её текущим представлением, простое значение выводится так же, как поле этого вида. Рядом
 * подписан тип значения: строка «100» и число 100 выглядят одинаково, а значения это разные.
 */
function CompositeDisplay({ field, value }: DisplayProperties<CompositeValue>) {
    const metadata = useMetadata().data;
    if (value === null || value === undefined) return null;
    const reference = value.type === 'reference' ? { kind: value.kind, name: value.name, guid: value.guid } : null;
    return (
        <>
            {value.type === 'reference'
                ? <RecordLink reference={{ kind: value.kind, name: value.name, guid: value.guid }} />
                // Вариант могли убрать из конфигурации; значение всё равно показывается по своему типу.
                : <FieldDisplay field={compositeVariant(field.variants, value) ?? { kind: value.type, target: null }} value={value.value} />}
            {' '}
            <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>· {compositeTypeTitle(metadata, value.type, reference)}</Typography.Text>
        </>
    );
}

/**
 * Поле ввода составного значения. Способ ввода определила платформа и передала в описании поля:
 * `fluent` означает, что каждый вариант вводится текстом. Экран может отключить текстовый ввод
 * свойством `inputMode`, но не включить его: поле с датой или флажком в одной строке не набрать.
 */
function CompositeInput(properties: CompositeInputProperties) {
    const Input = compositeInputs[properties.field.inputMode === 'fluent' && properties.inputMode !== 'solid' ? 'fluent' : 'solid'];
    return <Input {...properties} />;
}

/**
 * Выбор типа значения и поле ввода выбранного варианта (способ `solid`). Смена типа очищает
 * значение прежнего варианта. Тип значения виден в самом выборе, отдельной подписи ему не нужно.
 */
function CompositeSolidInput({ field, value, onChange, disabled, id, ref }: CompositeInputProperties) {
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
                options={variants.map((candidate, position) => ({ value: position, label: compositeTypeTitle(metadata, candidate.kind, candidate.target) }))}
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

/**
 * Компоненты составного поля по способам ввода. Тип контракта требует оба компонента: способ
 * выбирает описание поля, и виджет без одного из них оставил бы часть полей без ввода.
 */
export const compositeInputs: CompositeInputModes = { fluent: CompositeFluentInput, solid: CompositeSolidInput };
