/**
 * Общий контракт виджетов: полей ввода и компонентов отображения значений.
 *
 * Значение поля на всём пути остаётся в формате сервера: деньги в копейках, даты строками ISO,
 * ссылка в виде `guid`, отсутствие значения в виде `null`. В привычный человеку вид значение
 * переводит само поле ввода, и оно же переводит введённое обратно. Поэтому значения формы уходят
 * в `save`, а значение отбора в `list` без преобразования, и общего слоя преобразования нет.
 *
 * Свойства поля ввода повторяют набор, принятый для элементов формы Ant Design: значение,
 * обработчик изменения, признак недоступности. Поэтому одно и то же поле ввода ставится в шапку
 * формы, в ячейку табличной части, в условие отбора списка и в окно входных данных действия.
 */
import type { ComponentType, Ref } from 'react';
import type { FieldKind, ObjectTarget, RecorderValue, ValidationRules } from '../../server/ui/descriptions';

/**
 * Что виджету нужно знать о поле. Подходит и поле формы, и колонка, и отбор списка: у двух
 * последних правил проверки нет.
 */
export interface WidgetField {
    readonly kind: FieldKind;
    /** Объект, из записей которого выбирается ссылка. Заполнен только у вида `reference`. */
    readonly target: ObjectTarget | null;
    /** По правилам поле ввода ограничивает сам ввод, например не даёт ввести дробную часть целого числа. */
    readonly rules?: ValidationRules;
}

/** Типы значений по видам полей в формате сервера. */
export interface FieldValues {
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

/** Свойства поля ввода. Незаполненное значение приходит как `null` или `undefined`, а отдаётся всегда как `null`. */
export interface InputProperties<Value> {
    readonly field: WidgetField;
    readonly value?: Value | null | undefined;
    readonly onChange?: ((value: Value | null) => void) | undefined;
    readonly disabled?: boolean | undefined;
    /** Идентификатор элемента: его передаёт элемент формы Ant Design, чтобы подпись указывала на поле. */
    readonly id?: string | undefined;
    readonly ref?: Ref<InputHandle> | undefined;
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
