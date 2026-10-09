/**
 * Неизменяемые описания объектов конфигурации. Их собирает `commit()` билдера,
 * и с ними работает остальная платформа: структура БД, диспетчер, формы.
 */

import type { Formula } from '../../common/formulas.js';

/** Часть представления: текст, поле либо значения колонки через разделитель. */
export type PresentationPart =
    | { readonly text: string }
    | { readonly field: string; readonly format?: 'date' | 'dateTime' | 'number' }
    | { readonly tablePart: string; readonly field: string; readonly separator?: string };

/** Источник числовых подсказок, не сохраняющий ссылку в записи. */
export interface ValueSuggestions {
    readonly target: ObjectTarget;
    readonly field: string;
}

/** Вид объекта конфигурации. */
export type ObjectKind = 'catalog' | 'document' | 'register' | 'informationRegister';

/**
 * Вид поля:
 * - `string` — строка;
 * - `number` — число;
 * - `money` — деньги, целое число копеек;
 * - `date` — дата `YYYY-MM-DD`;
 * - `dateTime` — дата и время ISO 8601 с часовым поясом;
 * - `boolean` — логическое значение;
 * - `reference` — ссылка на справочник или документ, значение — `guid` объекта;
 * - `objectReference` — полная ссылка с видом объекта, именем и guid записи;
 * - `guid` — идентификатор объекта UUIDv7, только стандартное поле;
 * - `recorder` — ссылка на документ-регистратор движения регистра, только стандартное поле.
 */
export type FieldKind = 'string' | 'number' | 'money' | 'date' | 'dateTime' | 'boolean' | 'reference' | 'objectReference' | 'guid' | 'recorder';

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

/** Полная ссылка на запись любого справочника или документа. Тип является частью адреса. */
export interface ObjectReferenceValue extends ObjectTarget {
    readonly guid: string;
}

/** Значение поля `recorder`: документ-регистратор движения. */
export interface RecorderValue {
    readonly document: string;
    readonly guid: string;
}

/**
 * Описание поля объекта, строки табличной части или входных данных действия. По нему строятся
 * колонка таблицы, схема проверки входных данных и элемент формы. Свойства, которые к виду поля
 * не относятся (длина у числа, границы у строки), равны `null`.
 */
export interface FieldDescription {
    readonly name: string;
    readonly kind: FieldKind;
    readonly role: FieldRole;
    /** Подпись в интерфейсе; если она не задана в конфигурации, совпадает с именем. */
    readonly title: string;
    /** Поле должно быть заполнено: в записи у него нет значения `null`. */
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
    /** Предопределённые строковые значения либо null для свободного ввода. */
    readonly choices: ReadonlyArray<string> | null;
    /** Формула числового значения, исполняемая до записи и при вводе. */
    readonly computed?: Formula | null;
    /** Справочник, из которого можно подставить число. */
    readonly suggestions?: ValueSuggestions | null;
    /** Табличная часть записи по ссылке для раскрытия строки формы. */
    readonly expandedTablePart?: string | null;
}

/** Табличная часть: список строк внутри объекта. В записи она представлена массивом строк. */
export interface TablePartDescription {
    readonly name: string;
    readonly title: string;
    /** Поля одной строки. */
    readonly fields: ReadonlyArray<FieldDescription>;
}

/** Собственное действие объекта: диспетчер проверяет входные данные перед вызовом обработчика. */
export interface ActionDescription {
    readonly name: string;
    readonly title: string;
    readonly input: ReadonlyArray<FieldDescription>;
    /** Строки во входных данных действия. */
    readonly tableParts: ReadonlyArray<TablePartDescription>;
    /**
     * Аргумент типизирован как `never`, чтобы в одном списке хранились обработчики с разными
     * входными данными. Вызывать обработчик можно только после проверки входных данных по `input`.
     */
    readonly handler: ((input: never) => unknown) | null;
}

/**
 * Место собственного элемента формы в группе: имя объявления элемента. Объект отличает элемент
 * от поля и табличной части, которые в раскладке названы строкой: имена элементов общие для всей
 * конфигурации и могут совпасть с именем поля объекта.
 */
export interface FormElementReference {
    readonly element: string;
}

/**
 * Режим открытия формы записи: `tab` открывает её во вкладке с собственным адресом, `dialog` —
 * в модальном окне поверх страницы, из которой она открыта. У окна адреса нет.
 */
export type RecordOpeningMode = 'tab' | 'dialog';

/**
 * Переопределение формы. Применяет его построение описаний форм в `src/server/ui`.
 * `input` назначает собственный элемент полем ввода для поля: на форме он заменяет виджет вида поля.
 * `creation` задаёт режим, в котором форма новой записи открывается по умолчанию.
 */
export type FormOverride =
    | { readonly kind: 'group'; readonly title: string; readonly fields: ReadonlyArray<string | FormElementReference> }
    | { readonly kind: 'hide'; readonly field: string }
    | { readonly kind: 'title'; readonly field: string; readonly title: string }
    | { readonly kind: 'input'; readonly field: string; readonly element: string }
    | { readonly kind: 'creation'; readonly mode: RecordOpeningMode };

/** Переопределения формы в порядке объявления. Форму по умолчанию строит платформа из полей. */
export interface FormDescription {
    readonly overrides: ReadonlyArray<FormOverride>;
}

/** Политика объекта; тип записи скрыт после сборки разнородных описаний конфигурации. */
export interface PolicyDescription {
    readonly name: string;
    readonly save: ((input: never) => unknown) | null;
    readonly post: ((input: never) => unknown) | null;
    readonly unpost: ((input: never) => unknown) | null;
    readonly markDeleted: ((input: never) => unknown) | null;
    readonly unmarkDeleted: ((input: never) => unknown) | null;
    /** Проверка перед физическим удалением существующей записи сведений. */
    readonly delete: ((input: never) => unknown) | null;
}

/**
 * Представление записи по ссылке: запись справочника показывается представлением записи,
 * на которую ссылается её поле `field`. Цель повторена из описания поля, чтобы читающий код
 * не искал поле заново. Цель сама строит представление из своих полей: цепочки `commit()` отклоняет,
 * поэтому чтение представления не выходит за пределы двух записей.
 */
export interface DelegatedPresentation {
    readonly field: string;
    readonly target: ObjectTarget;
}

/**
 * Готовое описание объекта конфигурации, которое собирает `commit()`. Описание заморожено:
 * платформа читает его из разных модулей, и изменение в одном месте незаметно сломало бы другие.
 */
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
    /**
     * Поле-ссылка, по которому строится представление записи. `null` означает собственное
     * представление: наименование справочника либо заголовок, номер и дата документа.
     */
    readonly presentation: DelegatedPresentation | null;
    /** Части собственного представления; пустой массив оставляет стандартный текст. */
    readonly presentationParts: ReadonlyArray<PresentationPart>;
    /** Табличные части для раскрытия в списке. */
    readonly listTableParts: ReadonlyArray<string>;
    /**
     * Обработчик проведения документа; у справочников и регистров, а также у документа без
     * движений равен `null`. Аргумент типизирован как `never` по той же причине, что и у
     * обработчика действия: вызывать его можно только с записью этого документа.
     */
    readonly posting: ((record: never) => unknown) | null;
}

/**
 * Строки одного регистра, которые обработчик проведения возвращает платформе. Регистр указан
 * именем: сама строка ещё не проверена, её проверяет диспетчер по описанию регистра.
 */
export interface RegisterMovements {
    readonly register: string;
    readonly rows: ReadonlyArray<{ readonly [name: string]: unknown }>;
}
