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
 * - `composite` — составное поле: значение одного из объявленных вариантов вместе с его типом;
 * - `guid` — идентификатор объекта UUIDv7, только стандартное поле;
 * - `recorder` — ссылка на документ-регистратор движения регистра, только стандартное поле.
 */
export type FieldKind = 'string' | 'number' | 'money' | 'date' | 'dateTime' | 'boolean' | 'reference' | 'objectReference' | 'composite' | 'guid' | 'recorder';

/**
 * Тип варианта составного поля. Совпадает с видом поля варианта: простые виды платформы
 * и `reference` для ссылки на конкретный справочник или документ. Тип хранится рядом
 * со значением, поэтому строка «100» и число 100 остаются разными значениями.
 */
export type CompositeType = 'string' | 'number' | 'money' | 'date' | 'dateTime' | 'boolean' | 'reference';

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

/**
 * Способ ввода значения:
 * - `fluent` — значение можно написать текстом: строка, число, сумма, представление записи;
 * - `solid` — значению нужен собственный элемент ввода: календарь у даты, флажок у логического значения.
 * У составного поля способ определяет интерфейс целиком: `fluent` даёт одно текстовое поле
 * с подсказками по всем вариантам, `solid` требует сначала выбрать тип значения.
 */
export type InputMode = 'fluent' | 'solid';

/** Значение простого варианта составного поля: тип варианта и значение в формате поля этого вида. */
export interface CompositeScalarValue<Type extends Exclude<CompositeType, 'reference'>, Value> {
    readonly type: Type;
    readonly value: Value;
}

/** Значение ссылочного варианта составного поля: цель входит в значение, потому что целей у поля может быть несколько. */
export interface CompositeReferenceValue extends ObjectReferenceValue {
    readonly type: 'reference';
}

/**
 * Значение составного поля в записи и в API. Незаполненное поле равно `null`. Свойство `type`
 * различает варианты, поэтому после его проверки компилятор знает тип значения.
 */
export type CompositeValue =
    | CompositeScalarValue<'string' | 'date' | 'dateTime', string>
    | CompositeScalarValue<'number' | 'money', number>
    | CompositeScalarValue<'boolean', boolean>
    | CompositeReferenceValue;

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
    /** Значение строки в новой записи или новой строке формы. */
    readonly initial?: string | null;
    /** Формула числового значения, исполняемая до записи и при вводе. */
    readonly computed?: Formula | null;
    /** Справочник, из которого можно подставить число. */
    readonly suggestions?: ValueSuggestions | null;
    /** Табличная часть записи по ссылке для раскрытия строки формы. */
    readonly expandedTablePart?: string | null;
    /**
     * Варианты составного поля в порядке объявления; у остальных видов отсутствуют либо `null`.
     * Вариант описан как поле своего вида с именем и ролью составного поля: по нему строятся
     * схема проверки, хранение и виджет варианта. Вариант всегда обязателен: пустое значение
     * составного поля равно `null`, а не варианту без значения.
     */
    readonly variants?: ReadonlyArray<FieldDescription> | null;
    /**
     * Способ ввода значения. Его определяет платформа при сборке описания: у простого поля
     * по реестру видов, у составного по вариантам и настройке конфигурации. Клиент способ
     * не вычисляет. Отсутствует у полей, собранных вне `commit()`: им ввод не нужен.
     */
    readonly inputMode?: InputMode;
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
 * `input` создаётся из override объявления компонента и заменяет ввод поля или части.
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
 * Ограничение итога регистра: сумма ресурса по сочетанию значений измерений `by` не может быть
 * меньше `minimum`. Платформа проверяет ограничение после каждого изменения движений документа.
 */
export interface RegisterConstraintDescription {
    readonly name: string;
    /** Измерения, по которым группируется итог; пустой список означает итог по всему регистру. */
    readonly by: ReadonlyArray<string>;
    readonly resource: string;
    /** Наименьшее допустимое значение суммы (для денег — в копейках). */
    readonly minimum: number;
    /**
     * Функция текста отказа; `null` означает стандартный текст платформы. Аргумент типизирован
     * как `never` по той же причине, что и у обработчика действия: типы измерений и ресурсов
     * конкретного регистра стёрты после сборки описаний.
     */
    readonly message: ((violation: never) => unknown) | null;
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
    /** Ограничения итога; заполняются только у регистра оборотов. */
    readonly constraints: ReadonlyArray<RegisterConstraintDescription>;
}

/**
 * Строки одного регистра, которые обработчик проведения возвращает платформе. Регистр указан
 * именем: сама строка ещё не проверена, её проверяет диспетчер по описанию регистра.
 */
export interface RegisterMovements {
    readonly register: string;
    readonly rows: ReadonlyArray<{ readonly [name: string]: unknown }>;
}
