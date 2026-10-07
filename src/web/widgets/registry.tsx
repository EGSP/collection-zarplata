/**
 * Реестр виджетов: для каждого вида поля компонент ввода и компонент отображения.
 *
 * Формы и списки строятся по описаниям с сервера и о видах полей сами ничего не знают: компонент
 * для поля они берут из реестра. Реестр обязан перечислить все виды полей, и это проверяется
 * типами. Если на сервере появится новый вид поля, клиент не соберётся, пока для него
 * не добавлена пара компонентов.
 */
import type { ComponentType } from 'react';
import type { FieldKind } from '../../server/ui/descriptions';
import { ObjectReferenceDisplay, RecorderDisplay, ReferenceDisplay } from '../references/reference-display';
import { ObjectReferenceInput } from '../references/object-reference-input';
import { ReferenceInput } from '../references/reference-input';
import { BooleanDisplay, DateDisplay, DateTimeDisplay, MoneyDisplay, NumberDisplay, TextDisplay } from './displays';
import { BooleanInput, DateInput, DateTimeInput, MoneyInput, NumberInput, StringInput } from './inputs';
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
    const Input = widgets[properties.field.kind].input as ComponentType<InputProperties<unknown>> | null;
    return Input === null ? null : <Input {...properties} />;
}

/** Отображение значения поля любого вида. О типе значения см. `FieldInput`. */
export function FieldDisplay(properties: DisplayProperties<unknown>) {
    const Display = widgets[properties.field.kind].display as ComponentType<DisplayProperties<unknown>>;
    return <Display {...properties} />;
}
