/**
 * Общий контракт виджетов: полей ввода и компонентов отображения значений.
 *
 * Значение поля на всём пути остаётся в формате сервера: деньги в копейках, даты строками ISO,
 * ссылка в виде `guid` или `{ kind, name, guid }`, значение составного поля вместе с типом варианта, отсутствие значения в виде `null`. В привычный человеку вид значение
 * переводит само поле ввода, и оно же переводит введённое обратно. Поэтому значения формы уходят
 * в `save`, а значение отбора в `list` без преобразования, и общего слоя преобразования нет.
 *
 * Свойства поля ввода повторяют набор, принятый для элементов формы Ant Design: значение,
 * обработчик изменения, признак недоступности. Поэтому одно и то же поле ввода ставится в шапку
 * формы, в ячейку табличной части, в условие отбора списка и в окно входных данных действия.
 */
import type { ValueSuggestions } from '../../server/metadata/descriptions';
import type { ComponentType, Ref } from 'react';
import type { CompositeValue, ObjectReferenceValue } from '../../server/metadata/descriptions';
import type { FieldKind, InputMode, ObjectTarget, RecorderValue, ValidationRules } from '../../server/ui/descriptions';

/**
 * Что виджету нужно знать о поле. Подходит и поле формы, и колонка, и отбор списка: у двух
 * последних правил проверки нет.
 */
export interface WidgetField {
    readonly kind: FieldKind;
    readonly suggestions?: ValueSuggestions | null;
    /** Объект, из записей которого выбирается ссылка. Заполнен только у вида `reference`. */
    readonly target: ObjectTarget | null;
    /** Допустимые строковые значения для выбора. */
    readonly choices?: ReadonlyArray<string> | null;
    /** По правилам поле ввода ограничивает сам ввод, например не даёт ввести дробную часть целого числа. */
    readonly rules?: ValidationRules;
    /** Варианты составного поля: каждый описан как поле своего вида, и для него берётся виджет этого вида. */
    readonly variants?: ReadonlyArray<WidgetField> | null;
    /** Способ ввода, который платформа определила для поля; у составного поля выбирает его виджет. */
    readonly inputMode?: InputMode;
}

/** Типы значений по видам полей в формате сервера. */
export interface FieldValues {
    readonly objectReference: ObjectReferenceValue;
    /** Значение вместе с типом варианта: `{ type, value }` либо `{ type: 'reference', kind, name, guid }`. */
    readonly composite: CompositeValue;
    readonly string: string;
    readonly number: number;
    /** Целое число копеек. */
    readonly money: number;
    /** Строка `YYYY-MM-DD`. */
    readonly date: string;
    /** Строка ISO 8601 с часовым поясом. */
    readonly dateTime: string;
    readonly boolean: boolean;
    /** `guid` записи объекта, названного в `target` поля. */
    readonly reference: string;
    readonly guid: string;
    readonly recorder: RecorderValue;
}

/** Управление полем ввода извне. Через него форма переводит фокус, в том числе при обходе с клавиатуры. */
export interface InputHandle {
    focus(): void;
}

/** Включительные границы календарной даты в формате `YYYY-MM-DD`; отсутствие границы её не ограничивает. */
export interface DateLimits {
    readonly minimum?: string | undefined;
    readonly maximum?: string | undefined;
}

/** Свойства поля ввода. Незаполненное значение приходит как `null` или `undefined`, а отдаётся всегда как `null`. */
export interface InputProperties<Value> {
    readonly field: WidgetField;
    readonly value?: Value | null | undefined;
    readonly onChange?: ((value: Value | null) => void) | undefined;
    readonly disabled?: boolean | undefined;
    /** Границы выбора для вида `date`, в том числе при вводе с клавиатуры. Бизнес-правила дополнительно проверяет сервер. */
    readonly dateLimits?: DateLimits | undefined;
    /** Идентификатор элемента: его передаёт элемент формы Ant Design, чтобы подпись указывала на поле. */
    readonly id?: string | undefined;
    readonly ref?: Ref<InputHandle> | undefined;
    /**
     * Отключает единое текстовое поле составного значения на этом экране: пользователь сначала
     * выбирает тип. Включить текстовый ввод свойством нельзя: возможен ли он, определяет платформа
     * по вариантам поля. Остальные виды полей свойство не учитывают.
     */
    readonly inputMode?: 'solid' | undefined;
}

/** Свойства поля ввода составного значения; одинаковы для обоих способов ввода. */
export type CompositeInputProperties = InputProperties<CompositeValue>;

/**
 * Контракт виджета составного поля: компонент на каждый способ ввода. Реализация обязана
 * поддержать оба, потому что способ определяет не она, а описание поля и настройка экрана.
 * `fluent` принимает значение текстом и предлагает подсказки по всем вариантам, `solid`
 * сначала спрашивает тип значения.
 */
export interface CompositeInputModes {
    readonly fluent: ComponentType<CompositeInputProperties>;
    readonly solid: ComponentType<CompositeInputProperties>;
}

/** Свойства компонента отображения: значение выводится текстом и не редактируется. */
export interface DisplayProperties<Value> {
    readonly field: WidgetField;
    readonly value?: Value | null | undefined;
}

/**
 * Пара компонентов для вида поля. Поля ввода нет у видов, значения которых пользователь
 * не вводит: `guid` и регистратор заполняет платформа.
 */
export interface Widget<Value> {
    readonly input: ComponentType<InputProperties<Value>> | null;
    readonly display: ComponentType<DisplayProperties<Value>>;
}
