/**
 * Неизменяемые описания объектов конфигурации. Их собирает `commit()` построителя,
 * и с ними работает остальная платформа: структура БД, диспетчер, формы.
 */

/** Вид объекта конфигурации. */
export type ObjectKind = 'catalog' | 'document' | 'register';

/**
 * Вид поля:
 * - `string` — строка;
 * - `number` — число;
 * - `money` — деньги, целое число копеек;
 * - `date` — дата `YYYY-MM-DD`;
 * - `dateTime` — дата и время ISO 8601 с часовым поясом;
 * - `boolean` — логическое значение;
 * - `reference` — ссылка на справочник или документ, значение — `guid` объекта;
 * - `guid` — идентификатор объекта UUIDv7, только стандартное поле;
 * - `recorder` — ссылка на документ-регистратор движения регистра, только стандартное поле.
 */
export type FieldKind = 'string' | 'number' | 'money' | 'date' | 'dateTime' | 'boolean' | 'reference' | 'guid' | 'recorder';

/**
 * Роль поля в объекте:
 * - `standard` — стандартное поле вида объекта;
 * - `attribute` — реквизит, объявленный в конфигурации;
 * - `dimension` — измерение регистра;
 * - `resource` — ресурс регистра.
 */
export type FieldRole = 'standard' | 'attribute' | 'dimension' | 'resource';

/** Объект, на который ссылается поле. */
export interface ObjectTarget {
    readonly kind: 'catalog' | 'document';
    readonly name: string;
}

/** Значение поля `recorder`: документ-регистратор движения. */
export interface RecorderValue {
    readonly document: string;
    readonly guid: string;
}

export interface FieldDescription {
    readonly name: string;
    readonly kind: FieldKind;
    readonly role: FieldRole;
    readonly title: string;
    readonly required: boolean;
    /** Значение заполняет платформа, во входных данных действий поле не передаётся. */
    readonly managed: boolean;
    /** Минимальная длина строки. */
    readonly minimumLength: number | null;
    /** Максимальная длина строки. */
    readonly maximumLength: number | null;
    /** Нижняя граница числа или суммы (для денег — в копейках). */
    readonly minimum: number | null;
    /** Верхняя граница числа или суммы (для денег — в копейках). */
    readonly maximum: number | null;
    /** Число должно быть целым. У денег всегда `true`. */
    readonly integer: boolean;
    /** Цель ссылки; заполнена только у полей вида `reference`. */
    readonly target: ObjectTarget | null;
}

export interface TablePartDescription {
    readonly name: string;
    readonly title: string;
    readonly fields: ReadonlyArray<FieldDescription>;
}

/**
 * Собственное действие объекта. Пока только сохраняется в описании;
 * выполнение реализует диспетчер (#6).
 */
export interface ActionDescription {
    readonly name: string;
    readonly title: string;
    readonly input: ReadonlyArray<FieldDescription>;
    readonly handler: ((input: never) => unknown) | null;
}

/** Переопределение формы. Применяет построитель описаний форм (#11). */
export type FormOverride =
    | { readonly kind: 'group'; readonly title: string; readonly fields: ReadonlyArray<string> }
    | { readonly kind: 'hide'; readonly field: string }
    | { readonly kind: 'title'; readonly field: string; readonly title: string };

export interface FormDescription {
    readonly overrides: ReadonlyArray<FormOverride>;
}

/**
 * Политика записи. Пока только сохраняется в описании; выполнение реализует #10.
 */
export interface PolicyDescription {
    readonly canWrite: ((record: never) => unknown) | null;
    readonly beforeWrite: ((record: never) => unknown) | null;
}

export interface ObjectDescription {
    readonly kind: ObjectKind;
    readonly name: string;
    readonly title: string;
    /** Сначала стандартные поля, затем объявленные в порядке объявления. */
    readonly fields: ReadonlyArray<FieldDescription>;
    readonly tableParts: ReadonlyArray<TablePartDescription>;
    readonly actions: ReadonlyArray<ActionDescription>;
    readonly form: FormDescription | null;
    readonly policies: ReadonlyArray<PolicyDescription>;
}
