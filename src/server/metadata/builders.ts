/**
 * Билдеры объектов конфигурации: справочников, документов и регистров.
 *
 * Билдеры неизменяемы: каждый вызов возвращает новый билдер, а исходный не меняется. Файл
 * конфигурации экспортирует билдер, этот же билдер импортируют другие файлы для ссылок, а сервис
 * метаданных дополняет его стандартными полями. Изменяемый билдер получил бы стандартные поля
 * во всех местах сразу, а повторное дополнение продублировало бы их.
 *
 * Тип записи выводится из цепочки вызовов: каждый `.field(...)` возвращает билдер с расширенным
 * параметром типа `Fields`. В TypeScript нет типов высшего порядка, поэтому метод базового класса
 * не может вернуть «тот же подкласс с другими параметрами». Отсюда одна реализация
 * `ObjectBuilderImplementation` и отдельный интерфейс для каждого вида объекта: интерфейс задаёт
 * точные типы и набор методов, например `.dimension` есть только у регистра.
 *
 * Свойства с префиксом `~` служебные. Их читают `commit()` и выводы типов, а в подсказках
 * редактора они стоят в конце списка и не мешают методам описания.
 */
import type { PresentationPart } from './descriptions.js';
import type { Effect } from 'effect';
import { commitObject } from './commit.js';
import type { ActionConfirmation, ActionConfirmationTone, ActionPlacement, FieldRole, FormOverride, ObjectDescription, ObjectKind, PolicyDescription, RecordOpeningMode, RegisterConstraintDescription, RegisterMovements } from './descriptions.js';
import {
    fieldFactory,
    type AnyFieldBuilder,
    type FieldFactory,
    type FieldMap,
    type FieldsRecord,
    type MoneyFieldBuilder,
    type NumberFieldBuilder,
    type RequiredField,
} from './fields.js';
import type { MetadataError } from './metadata.errors.js';
import { managedStandardFields, standardFields, type StandardFields } from './standard-fields.js';

/**
 * Поле в том виде, в каком его объявили: имя, роль и билдер поля. Проверку и сборку описания
 * выполняет `commit()`, поэтому здесь сохраняются и ошибочные объявления, например повторы имён.
 */
export interface FieldEntry {
    readonly name: string;
    readonly role: FieldRole;
    /** Значение заполняет платформа; у полей, объявленных в конфигурации, всегда `false`. */
    readonly managed: boolean;
    readonly builder: AnyFieldBuilder;
}

/** Объявленная табличная часть. `title` равен `null`, если заголовок не задан. */
export interface TablePartEntry {
    readonly name: string;
    readonly title: string | null;
    readonly fields: ReadonlyArray<FieldEntry>;
}

/** Объявленное собственное действие. `handler` равен `null`, пока не вызван `handle(...)`. */
export interface ActionEntry {
    readonly name: string;
    readonly title: string | null;
    readonly input: ReadonlyArray<FieldEntry>;
    readonly tableParts: ReadonlyArray<TablePartEntry>;
    readonly handler: ((input: never) => unknown) | null;
    readonly placement: ActionPlacement;
    readonly confirmation: ActionConfirmation | null;
}

/**
 * Объявленное ограничение итога регистра. `resource` и `minimum` равны `null`, пока не вызван
 * `minimum(...)`: такое ограничение отклоняет `commit()`.
 */
export interface ConstraintEntry {
    readonly name: string;
    readonly by: ReadonlyArray<string>;
    readonly resource: string | null;
    readonly minimum: number | null;
    readonly message: RegisterConstraintDescription['message'];
}

/**
 * Объявленный подбор. `search` равен `null`, пока не вызван `search(...)`: такой подбор
 * отклоняет `commit()`.
 */
export interface LookupEntry {
    readonly columns: ReadonlyArray<FieldEntry>;
    readonly search: ((input: never) => unknown) | null;
}

/** Всё, что накопила цепочка вызовов билдера объекта. Из этого состояния `commit()` собирает описание. */
export interface ObjectState {
    readonly kind: ObjectKind;
    readonly name: string;
    readonly title: string | null;
    readonly fields: ReadonlyArray<FieldEntry>;
    readonly tableParts: ReadonlyArray<TablePartEntry>;
    readonly actions: ReadonlyArray<ActionEntry>;
    readonly form: ReadonlyArray<FormOverride> | null;
    readonly policies: ReadonlyArray<PolicyDescription>;
    /** Имя поля-ссылки, по которому строится представление записи; задаётся только у справочника. */
    readonly presentation: string | null;
    readonly presentationParts: ReadonlyArray<PresentationPart>;
    readonly listTableParts: ReadonlyArray<string>;
    /** Обработчик проведения; задаётся только у документа. */
    readonly posting: ((record: never) => unknown) | null;
    /** Ограничения итога; задаются только у регистра оборотов. */
    readonly constraints: ReadonlyArray<ConstraintEntry>;
    /** Подбор записей для полей ссылки; задаётся только у справочника и документа. */
    readonly lookup: LookupEntry | null;
    /** Вызван ли `withStandardFields()`: без стандартных полей `commit()` завершается ошибкой. */
    readonly standardFieldsAdded: boolean;
}

/** Создаёт запись объявленного поля; функция описания получает общую фабрику полей. */
function attribute(name: string, define: (field: FieldFactory) => AnyFieldBuilder, role: FieldRole = 'attribute'): FieldEntry {
    return { name, role, managed: false, builder: define(fieldFactory) };
}

/** Раскрывает пересечение типов в один объект, чтобы подсказка редактора показывала список полей, а не цепочку `A & B & C`. */
type Simplify<T> = { [K in keyof T]: T[K] } & {};

/** Табличные части объекта: имя → поля строки. */
export type TablePartMap = { readonly [name: string]: FieldMap };

/** Тип записи объекта: стандартные поля вида, объявленные поля и табличные части. */
export type ObjectRecord<Kind extends ObjectKind, Fields extends FieldMap, Parts extends TablePartMap> = Simplify<
    FieldsRecord<StandardFields[Kind] & Fields> & {
        readonly [Part in keyof Parts]: ReadonlyArray<FieldsRecord<Parts[Part]>>;
    }
>;

/** Тип записи объекта по его билдеру: `RecordOf<typeof Employees>`. */
export type RecordOf<Builder extends ObjectBuilder> = ObjectRecord<Builder['kind'], Builder['~fields'], Builder['~tableParts']>;

/**
 * Тип строки списка объекта по его билдеру: стандартные и объявленные поля без табличных частей.
 * Действие `list` табличные части не возвращает: они хранятся отдельно и читаются действием `get`.
 */
export type ListRecordOf<Builder extends ObjectBuilder> = Simplify<FieldsRecord<StandardFields[Builder['kind']] & Builder['~fields']>>;

/** Значения экспорта модуля. Условный тип распределяет объединение модулей: иначе остались бы только общие имена экспорта. */
export type ExportsOf<Module> = Module extends unknown ? Module[keyof Module] : never;

/** Билдеры объектов среди экспорта модулей конфигурации. */
export type BuildersOf<Modules extends ReadonlyArray<object>> = Extract<ExportsOf<Modules[number]>, ObjectBuilder>;

/** Имена полей объекта, включая стандартные. */
type FieldNames<Kind extends ObjectKind, Fields extends FieldMap> = keyof StandardFields[Kind] & string | keyof Fields & string;

/**
 * Ограничение имени с причиной в сообщении компилятора. Широкий string не раскрывает
 * конкретное имя; если накопленные ключи уже расширены до string, повторы проверяет commit().
 * Пересечение сохраняет литеральный тип имени, а текст причины объясняет конфликт вместо never.
 */
type AvailableName<Name extends string, Existing extends PropertyKey, Reason extends string> =
    string extends Name ? unknown : string extends Existing ? unknown :
    [Extract<Name, Existing>] extends [never] ? unknown : { readonly nameError: Reason; readonly conflictingName: Extract<Name, Existing> };

/** Стандартные поля проверяются отдельно: широкие прикладные имена не отменяют этот запрет. */
type AvailableFieldName<Name extends string, Kind extends ObjectKind, Fields extends FieldMap> = Name
    & AvailableName<NoInfer<Name>, keyof StandardFields[Kind], 'имя поля совпадает со стандартным полем'>
    & AvailableName<NoInfer<Name>, keyof Fields, 'имя поля повторяется'>;

/** Билдер табличной части: заголовок и поля строки. */
export class TablePartBuilder<Fields extends FieldMap = {}> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~fields': Fields;
    readonly '~title': string | null;
    readonly '~entries': ReadonlyArray<FieldEntry>;

    constructor(title: string | null = null, entries: ReadonlyArray<FieldEntry> = []) {
        this['~title'] = title;
        this['~entries'] = entries;
    }

    /** Подключает общие колонки; добавленные затем поля сохраняют точные типы. */
    include<Common extends FieldMap>(part: TablePartBuilder<Common>): TablePartBuilder<Fields & Common> {
        return new TablePartBuilder(this['~title'], [...this['~entries'], ...part['~entries']]);
    }

    title(title: string): TablePartBuilder<Fields> {
        return new TablePartBuilder(title, this['~entries']);
    }

    /** Поле строки с уникальным литеральным именем; широкие имена проверяет сборка описания. */
    field<const Name extends string, Field extends AnyFieldBuilder>(
        name: Name & AvailableName<NoInfer<Name>, keyof Fields, 'имя поля повторяется'>,
        define: (field: FieldFactory) => Field,
    ): TablePartBuilder<Fields & { readonly [K in Name]: Field }> {
        return new TablePartBuilder(this['~title'], [...this['~entries'], attribute(name, define)]);
    }
}

/** Общее описание строк, подключаемое к нескольким объектам через part.include(). */
export function tablePart<Fields extends FieldMap>(define: (part: TablePartBuilder) => TablePartBuilder<Fields>): TablePartBuilder<Fields> {
    return define(new TablePartBuilder());
}

/** Билдер входных данных собственного действия. Поля объявляются так же, как поля объекта. */
export class ActionInputBuilder<Fields extends FieldMap = {}, Parts extends TablePartMap = {}> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~fields': Fields;
    readonly '~entries': ReadonlyArray<FieldEntry>;

    readonly '~parts': ReadonlyArray<TablePartEntry>;
    declare readonly '~tableParts': Parts;
    constructor(entries: ReadonlyArray<FieldEntry> = [], parts: ReadonlyArray<TablePartEntry> = []) {
        this['~parts'] = parts;
        this['~entries'] = entries;
    }

    /** Поле входных данных с уникальным литеральным именем в пределах этого действия. */
    field<const Name extends string, Field extends AnyFieldBuilder>(
        name: Name & AvailableName<NoInfer<Name>, keyof Fields | keyof Parts, 'имя поля повторяется'>,
        define: (field: FieldFactory) => Field,
    ): ActionInputBuilder<Fields & { readonly [K in Name]: Field }, Parts> {
        return new ActionInputBuilder([...this['~entries'], attribute(name, define)], this['~parts']);
    }
    /** Строки входных данных; имя не пересекается с полями и другими частями. */
    tablePart<const Name extends string, PartFields extends FieldMap>(name: Name & AvailableName<NoInfer<Name>, keyof Fields | keyof Parts, 'имя входных данных повторяется'>, define: (part: TablePartBuilder) => TablePartBuilder<PartFields>): ActionInputBuilder<Fields, Parts & { readonly [K in Name]: PartFields }> {
        const part = define(new TablePartBuilder());
        return new ActionInputBuilder(this['~entries'], [...this['~parts'], { name, title: part['~title'], fields: part['~entries'] }]);
    }
}

/**
 * Обработчик собственного действия получает проверенные входные данные и возвращает Effect.
 * Его ошибки прерывают всю транзакцию запроса. Через окружение ему доступны контекст действия,
 * диспетчер вложенных вызовов и чтение базы данных. Запись через Database запрещена;
 * для изменения объектов обработчик вызывает ActionDispatcher.
 */
export type ActionHandler<Input> = (input: Input) => Effect.Effect<unknown, unknown, unknown>;

/** Настройки окна подтверждения в объявлении действия; незаданные берутся по умолчанию. */
export interface ActionConfirmationOptions {
    /** Секунды до того, как «Подтверждаю» станет доступна. По умолчанию 0. */
    readonly delay?: number;
    readonly title?: string;
    readonly message?: string;
    /** Оформление окна. По умолчанию `warning`. */
    readonly tone?: ActionConfirmationTone;
}

/** Объявленное о действии помимо входных данных и обработчика: заголовок, место показа, подтверждение. */
interface ActionSettings {
    readonly title: string | null;
    readonly placement: ActionPlacement;
    readonly confirmation: ActionConfirmation | null;
}

const defaultActionSettings: ActionSettings = { title: null, placement: 'buttons', confirmation: null };

/** Билдер собственного действия; обработчик вызывается диспетчером после проверки данных. */
export class ActionBuilder<Input extends FieldMap = {}, Parts extends TablePartMap = {}> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~input': Input;
    readonly '~title': string | null;
    readonly '~placement': ActionPlacement;
    readonly '~confirmation': ActionConfirmation | null;
    readonly '~entries': ReadonlyArray<FieldEntry>;
    readonly '~handler': ((input: never) => unknown) | null;

    readonly '~parts': ReadonlyArray<TablePartEntry>;
    declare readonly '~tableParts': Parts;
    constructor(settings: ActionSettings = defaultActionSettings, entries: ReadonlyArray<FieldEntry> = [], handler: ((input: never) => unknown) | null = null, parts: ReadonlyArray<TablePartEntry> = []) {
        this['~parts'] = parts;
        this['~title'] = settings.title;
        this['~placement'] = settings.placement;
        this['~confirmation'] = settings.confirmation;
        this['~entries'] = entries;
        this['~handler'] = handler;
    }

    /** Настройки этого билдера: каждый метод переносит их в новый билдер. */
    private get settings(): ActionSettings {
        return { title: this['~title'], placement: this['~placement'], confirmation: this['~confirmation'] };
    }

    title(title: string): ActionBuilder<Input, Parts> {
        return new ActionBuilder({ ...this.settings, title }, this['~entries'], this['~handler'], this['~parts']);
    }

    /**
     * Где форма записи предлагает действие (`ActionPlacement`). По умолчанию кнопкой; `more`
     * переносит его в меню «Ещё», `hidden` убирает с формы для вызова из собственного экрана.
     */
    placement(placement: ActionPlacement): ActionBuilder<Input, Parts> {
        return new ActionBuilder({ ...this.settings, placement }, this['~entries'], this['~handler'], this['~parts']);
    }

    /**
     * Требует подтверждения перед выполнением: интерфейс открывает окно с кнопками «Подтверждаю»,
     * «Отмена» и крестиком, а «Подтверждаю» становится доступна через `delay` секунд. Так
     * необратимое действие не выполняется случайным нажатием.
     *
     * ```ts
     * .action('cancel', (action) => action
     *     .title('Отмена продажи')
     *     .confirmation({ delay: 3, tone: 'danger', message: 'Продажа и её рассрочки будут помечены на удаление.' }))
     * ```
     */
    confirmation(options: ActionConfirmationOptions = {}): ActionBuilder<Input, Parts> {
        const confirmation: ActionConfirmation = { delay: options.delay ?? 0, title: options.title ?? null, message: options.message ?? null, tone: options.tone ?? 'warning' };
        return new ActionBuilder({ ...this.settings, confirmation }, this['~entries'], this['~handler'], this['~parts']);
    }

    /**
     * Поля входных данных. Заменяет ранее объявленные и сбрасывает обработчик: тип его аргумента
     * выводится из полей, поэтому заданный раньше обработчик мог ожидать другие данные.
     */
    input<Fields extends FieldMap, InputParts extends TablePartMap>(define: (input: ActionInputBuilder) => ActionInputBuilder<Fields, InputParts>): ActionBuilder<Fields, InputParts> {
        const input = define(new ActionInputBuilder());
        return new ActionBuilder(this.settings, input['~entries'], null, input['~parts']);
    }

    /** Обработчик действия; получает входные данные, проверенные по объявленным полям. */
    handle(handler: ActionHandler<FieldsRecord<Input> & { readonly [Name in keyof Parts]: ReadonlyArray<FieldsRecord<Parts[Name]>> }>): ActionBuilder<Input, Parts> {
        return new ActionBuilder(this.settings, this['~entries'], handler, this['~parts']);
    }
}

/**
 * Входные данные функции подбора: строка поиска и страница. `search` передаётся как ввёл
 * пользователь, без обрезки пробелов и приведения регистра: как искать, решает функция.
 * `offset` — число строк перед страницей, уже посчитанное по `page` и `pageSize`.
 */
export interface LookupInput {
    readonly search: string;
    readonly page: number;
    readonly pageSize: number;
    readonly offset: number;
}

/**
 * Результат функции подбора: строки страницы и общее число найденных строк. Строка содержит
 * `guid` записи, который поле получит при выборе, и значения колонок подбора.
 */
export interface LookupResult<Columns extends FieldMap> {
    readonly total: number;
    readonly rows: ReadonlyArray<Simplify<{ readonly guid: string } & FieldsRecord<Columns>>>;
}

/**
 * Функция подбора. Она не зависит от формы и клиента: получает только строку поиска и страницу.
 * Через окружение ей доступны чтение базы данных и метаданные; запись через Database запрещена.
 */
export type LookupSearch<Columns extends FieldMap> = (input: LookupInput) => Effect.Effect<LookupResult<Columns>, unknown, unknown>;

/**
 * Билдер подбора: колонки таблицы в окне подбора и функция, которая ищет строки. Колонки
 * объявляются так же, как поля объекта: вид поля задаёт, как окно форматирует значение.
 */
export class LookupBuilder<Columns extends FieldMap = {}> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~columns': Columns;
    readonly '~entry': LookupEntry;

    constructor(entry: LookupEntry = { columns: [], search: null }) {
        this['~entry'] = entry;
    }

    /** Колонка таблицы подбора с уникальным литеральным именем. */
    column<const Name extends string, Field extends AnyFieldBuilder>(
        name: Name & AvailableName<NoInfer<Name>, keyof Columns | 'guid', 'имя колонки повторяется или совпадает с guid'>,
        define: (field: FieldFactory) => Field,
    ): LookupBuilder<Columns & { readonly [K in Name]: Field }> {
        return new LookupBuilder({ ...this['~entry'], columns: [...this['~entry'].columns, attribute(name, define)] });
    }

    /** Функция поиска строк. Объявляется после колонок: тип её результата выводится из них. */
    search(search: LookupSearch<Columns>): LookupBuilder<Columns> {
        return new LookupBuilder({ ...this['~entry'], search });
    }
}

/**
 * Переопределение формы по умолчанию. `Names` — имена полей и табличных частей объекта,
 * `Fields` — только имена полей, поэтому TypeScript отклоняет несуществующие имена.
 *
 * По умолчанию форма — одна группа без заголовка: поля в порядке объявления, затем табличные
 * части. Группы выводятся в порядке объявления, а элементы, не попавшие ни в одну группу,
 * собираются после них в группу без заголовка. Порядок обхода с клавиатуры следует за раскладкой.
 *
 * Подключение компонента задаётся в соседнем с ним файле `*.form-element.ts`.
 * Генератор проверяет парность файлов, сборка конфигурации проверяет места подключения.
 */
export class FormBuilder<Names extends string> {
    readonly '~overrides': ReadonlyArray<FormOverride>;

    constructor(overrides: ReadonlyArray<FormOverride> = []) {
        this['~overrides'] = overrides;
    }

    /**
     * Группа с заголовком из полей и табличных частей; они выводятся
     * в указанном порядке. Порядок обхода с клавиатуры следует за порядком группы.
     */
    group(title: string, fields: ReadonlyArray<Names>): FormBuilder<Names> {
        return new FormBuilder([...this['~overrides'], { kind: 'group', title, fields }]);
    }

    /** Скрыть поле или табличную часть. Обязательное поле, которое заполняет пользователь, скрыть нельзя. */
    hide(field: Names): FormBuilder<Names> {
        return new FormBuilder([...this['~overrides'], { kind: 'hide', field }]);
    }

    /** Подпись поля или табличной части на форме. */
    title(field: Names, title: string): FormBuilder<Names> {
        return new FormBuilder([...this['~overrides'], { kind: 'title', field, title }]);
    }

    /**
     * Режим, в котором форма новой записи открывается по умолчанию: во вкладке либо в модальном
     * окне поверх списка. Это только умолчание: место вызова может указать режим само, а прямой
     * адрес новой записи всегда открывает вкладку. Без этого вызова запись создаётся во вкладке.
     */
    creation(mode: RecordOpeningMode): FormBuilder<Names> {
        return new FormBuilder([...this['~overrides'], { kind: 'creation', mode }]);
    }
}

/** Существующая и предлагаемая записи для проверки сохранения до изменяющих запросов. */
export interface SavePolicyInput<Record> {
    readonly existingRecord: Record | null;
    readonly proposedRecord: Record;
}

/** Данные для проверки проведения или отмены проведения существующего документа. */
export interface PostingPolicyInput<Record> {
    readonly document: Record;
}

/** Данные для проверки изменения пометки удаления существующей записи. */
export interface DeletionPolicyInput<Record> {
    readonly record: Record;
}

/**
 * Прикладные проверки перед стандартными изменяющими действиями. Каждый обработчик необязателен;
 * отсутствие обработчика означает, что политика не ограничивает соответствующее действие.
 */
export interface Policy<Record> {
    readonly name: string;
    readonly save?: (input: SavePolicyInput<Record>) => Effect.Effect<void, unknown, unknown>;
    readonly post?: (input: PostingPolicyInput<Record>) => Effect.Effect<void, unknown, unknown>;
    readonly unpost?: (input: PostingPolicyInput<Record>) => Effect.Effect<void, unknown, unknown>;
    readonly markDeleted?: (input: DeletionPolicyInput<Record>) => Effect.Effect<void, unknown, unknown>;
    readonly unmarkDeleted?: (input: DeletionPolicyInput<Record>) => Effect.Effect<void, unknown, unknown>;
    /** Проверка перед физическим удалением сведений; получает существующую запись. */
    readonly delete?: (input: DeletionPolicyInput<Record>) => Effect.Effect<void, unknown, unknown>;
}

/**
 * Общая часть билдеров всех видов объектов. Этого интерфейса достаточно сервису метаданных:
 * ему нужны вид и имя объекта, `withStandardFields()` и `commit()`.
 */
export interface ObjectBuilder<Kind extends ObjectKind = ObjectKind, Name extends string = string> {
    readonly kind: Kind;
    readonly name: Name;
    /** Только для вывода типов: объявленные поля. */
    readonly '~fields': FieldMap;
    /** Только для вывода типов: табличные части. */
    readonly '~tableParts': TablePartMap;
    /** Только для вывода типов: имена собственных действий. По ним выводятся права на эти действия. */
    readonly '~actions': string;
    readonly '~state': ObjectState;

    /**
     * Добавляет стандартные поля вида объекта перед объявленными. Вызывает сервис метаданных
     * перед `commit()`; повторный вызов ничего не меняет.
     */
    withStandardFields(): this;

    /**
     * Проверяет описание и собирает неизменяемое описание объекта. `configuration` — билдеры всех
     * объектов конфигурации: без них нельзя проверить, что объект ссылки существует.
     * `formElements` — имена объявленных элементов формы: форма со ссылкой на другой элемент
     * отклоняется. При ошибках завершается `MetadataError` со списком всех найденных проблем.
     */
    commit(configuration: ReadonlyArray<ObjectBuilder>, formElements?: ReadonlySet<string>): Effect.Effect<ObjectDescription, MetadataError>;
}

/** Билдер справочника или документа: у них одинаковый набор возможностей описания. */
export interface RecordObjectBuilder<
    Kind extends 'catalog' | 'document',
    Name extends string,
    Fields extends FieldMap,
    Parts extends TablePartMap,
    Actions extends string = never,
> extends ObjectBuilder<Kind, Name> {
    readonly '~fields': Fields;
    readonly '~tableParts': Parts;
    readonly '~actions': Actions;

    /** Заголовок объекта в интерфейсе. Если он не задан, используется имя. */
    title(title: string): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;

    /** Реквизит объекта. Литеральное имя проверяется на повтор и совпадение со стандартным полем. */
    field<const FieldName extends string, Field extends AnyFieldBuilder>(
        name: AvailableFieldName<FieldName, Kind, Fields>,
        define: (field: FieldFactory) => Field,
    ): RecordBuilderOf<Kind, Name, Fields & { readonly [K in FieldName]: Field }, Parts, Actions>;

    /** Табличная часть с уникальным литеральным именем; в записи представлена массивом строк. */
    tablePart<const PartName extends string, PartFields extends FieldMap>(
        name: PartName & AvailableName<NoInfer<PartName>, keyof Parts, 'имя табличной части повторяется'>,
        define: (part: TablePartBuilder) => TablePartBuilder<PartFields>,
    ): RecordBuilderOf<Kind, Name, Fields, Parts & { readonly [K in PartName]: PartFields }, Actions>;

    /** Собственное действие с уникальным литеральным именем; имя также определяет право на действие. */
    action<const ActionName extends string, Input extends FieldMap, InputParts extends TablePartMap>(
        name: ActionName & AvailableName<NoInfer<ActionName>, Actions, 'имя собственного действия повторяется'>,
        define: (action: ActionBuilder) => ActionBuilder<Input, InputParts>,
    ): RecordBuilderOf<Kind, Name, Fields, Parts, Actions | ActionName>;

    /** Части собственного представления; ссылки разрешает сервер при чтении. */
    presentation(parts: ReadonlyArray<PresentationPart>): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;
    /** Табличные части, раскрываемые под строкой списка. */
    listTableParts(names: ReadonlyArray<keyof Parts & string>): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;

    /** Переопределение формы. Повторный вызов заменяет предыдущее. */
    form(
        define: (
            form: FormBuilder<FieldNames<Kind, Fields> | keyof Parts & string>,
        ) => FormBuilder<FieldNames<Kind, Fields> | keyof Parts & string>,
    ): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;

    /** Политика объекта. Политики из нескольких вызовов выполняются по порядку. */
    policy(policy: Policy<ObjectRecord<Kind, Fields, Parts>>): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;

    /**
     * Подбор записей объекта: у каждого поля ссылки на объект появляется кнопка, которая открывает
     * окно с поиском и таблицей. Колонки и функцию поиска задаёт `define`; клиент только показывает
     * строки, которые вернула функция. Повторный вызов заменяет подбор.
     */
    lookup<Columns extends FieldMap>(define: (lookup: LookupBuilder) => LookupBuilder<Columns>): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;
}

/** Билдер справочника; его создаёт `catalog(name)`. */
export interface CatalogBuilder<Name extends string, Fields extends FieldMap, Parts extends TablePartMap, Actions extends string = never>
    extends RecordObjectBuilder<'catalog', Name, Fields, Parts, Actions> {
    /**
     * Представление записи по ссылке: запись показывается не наименованием, а представлением
     * записи, на которую ссылается поле `field`. Так справочник называется значением, которое
     * хранится в другом объекте, и копия этого значения не расходится с оригиналом.
     * Поле должно быть обязательной ссылкой с заданной целью, а цель не может сама строить
     * представление по ссылке; это проверяет `commit()`. Наименование остаётся обычным
     * обязательным полем. Повторный вызов заменяет поле.
     */
    presentation(field: keyof Fields & string): CatalogBuilder<Name, Fields, Parts, Actions>;
    presentation(parts: ReadonlyArray<PresentationPart>): CatalogBuilder<Name, Fields, Parts, Actions>;
}

/**
 * Билдер того же вида, что и исходный. Методы общего интерфейса возвращают его, чтобы после
 * `.field(...)` у документа остался метод `.posting(...)`, которого нет у справочника.
 */
type RecordBuilderOf<Kind extends 'catalog' | 'document', Name extends string, Fields extends FieldMap, Parts extends TablePartMap, Actions extends string> =
    Kind extends 'document' ? DocumentBuilder<Name, Fields, Parts, Actions> : CatalogBuilder<Name, Fields, Parts, Actions>;

/**
 * Обработчик проведения получает сохранённую запись документа с табличными частями и возвращает
 * строки регистров, собранные функцией `movements(...)`. Через окружение ему доступны контекст
 * действия, диспетчер вложенных вызовов и чтение базы данных. Ошибка обработчика отменяет проведение
 * вместе со всей транзакцией запроса.
 */
export type PostingHandler<Record> = (record: Record) => Effect.Effect<ReadonlyArray<RegisterMovements>, unknown, unknown>;

/** Билдер документа; его создаёт `document(name)`. */
export interface DocumentBuilder<Name extends string, Fields extends FieldMap, Parts extends TablePartMap, Actions extends string = never>
    extends RecordObjectBuilder<'document', Name, Fields, Parts, Actions> {
    /**
     * Обработчик проведения. Платформа удаляет прежние движения документа во всех регистрах
     * и записывает строки, которые вернул обработчик, поэтому повторное проведение их не дублирует.
     * Повторный вызов заменяет обработчик.
     */
    posting(handler: PostingHandler<ObjectRecord<'document', Fields, Parts>>): DocumentBuilder<Name, Fields, Parts, Actions>;
}

/** Ресурс регистра — число или деньги: только такие значения можно суммировать при расчёте оборотов. */
type ResourceFieldBuilder = NumberFieldBuilder | MoneyFieldBuilder;

/**
 * Независимые текущие сведения. Измерения обязательны и составляют ключ, ресурсы
 * допускают любой прикладной вид поля. У записей нет стандартных полей и формы.
 */
export interface InformationRegisterBuilder<Name extends string, Fields extends FieldMap> extends ObjectBuilder<'informationRegister', Name> {
    readonly '~fields': Fields;
    readonly '~tableParts': {};
    readonly '~actions': never;

    /** Заголовок списка сведений. */
    title(title: string): InformationRegisterBuilder<Name, Fields>;
    /** Часть ключа; обязательность добавляется независимо от вызова required(). */
    dimension<const FieldName extends string, Field extends AnyFieldBuilder>(
        name: AvailableFieldName<FieldName, 'informationRegister', Fields>,
        define: (field: FieldFactory) => Field,
    ): InformationRegisterBuilder<Name, Fields & { readonly [K in FieldName]: Field & RequiredField }>;
    /** Хранимое значение, которое save заменяет вместе с остальными ресурсами. */
    resource<const FieldName extends string, Field extends AnyFieldBuilder>(
        name: AvailableFieldName<FieldName, 'informationRegister', Fields>,
        define: (field: FieldFactory) => Field,
    ): InformationRegisterBuilder<Name, Fields & { readonly [K in FieldName]: Field }>;
    /** Прикладные проверки записи и физического удаления. */
    policy(policy: Policy<ObjectRecord<'informationRegister', Fields, {}>>): InformationRegisterBuilder<Name, Fields>;
}

/** Имена ресурсов регистра: поля, которые не объявлены измерениями. */
export type ResourceNames<Fields extends FieldMap, Dimensions extends string> = Exclude<keyof Fields & string, Dimensions>;

/** Суммы всех ресурсов регистра по именам. */
export type ResourceTotals<Fields extends FieldMap, Dimensions extends string> = { readonly [Resource in ResourceNames<Fields, Dimensions>]: number };

/**
 * Данные для текста отказа: значения измерений нарушенного сочетания и суммы всех ресурсов
 * регистра по нему после изменения движений.
 */
export interface ConstraintViolation<Fields extends FieldMap, Dimensions extends string, By extends Dimensions> {
    readonly dimensions: Simplify<Pick<FieldsRecord<Fields>, By & keyof Fields>>;
    readonly totals: Simplify<ResourceTotals<Fields, Dimensions>>;
}

/**
 * Билдер ограничения итога регистра. `By` накапливает измерения из `by(...)`, поэтому функция
 * текста отказа получает значения именно этих измерений; `by(...)` вызывается раньше `message(...)`.
 * Без `by(...)` ограничение относится к итогу по всему регистру.
 */
export class RegisterConstraintBuilder<Fields extends FieldMap, Dimensions extends string, By extends Dimensions = never> {
    readonly '~entry': ConstraintEntry;

    constructor(entry: ConstraintEntry) {
        this['~entry'] = entry;
    }

    /** Измерения, по сочетанию значений которых считается итог. Повторный вызов заменяет список. */
    by<const Names extends ReadonlyArray<Dimensions>>(names: Names): RegisterConstraintBuilder<Fields, Dimensions, Names[number]> {
        return new RegisterConstraintBuilder({ ...this['~entry'], by: names });
    }

    /** Ресурс и наименьшее допустимое значение его суммы; для денег значение задаётся в копейках. */
    minimum(resource: ResourceNames<Fields, Dimensions>, value: number): RegisterConstraintBuilder<Fields, Dimensions, By> {
        return new RegisterConstraintBuilder({ ...this['~entry'], resource, minimum: value });
    }

    /**
     * Текст отказа. Функция возвращает Effect и может читать данные в транзакции действия,
     * например представление документа из измерения; изменять базу она не может. Без этого
     * вызова платформа называет в отказе регистр, ресурс, итог и допустимое значение.
     */
    message(message: (violation: ConstraintViolation<Fields, Dimensions, By>) => Effect.Effect<string, unknown, unknown>): RegisterConstraintBuilder<Fields, Dimensions, By> {
        return new RegisterConstraintBuilder({ ...this['~entry'], message });
    }
}

/**
 * Билдер регистра оборотов. Строки регистра записывают документы при проведении. `Dimensions`
 * хранит имена измерений отдельно от `Fields`: по типу поля измерение от ресурса не отличить,
 * а итоги и ограничения принимают в одних местах только измерения, в других только ресурсы.
 */
export interface RegisterBuilder<Name extends string, Fields extends FieldMap, Dimensions extends string = never> extends ObjectBuilder<'register', Name> {
    readonly '~fields': Fields;
    readonly '~tableParts': {};
    /** У регистра нет собственных действий. */
    readonly '~actions': never;
    /** Только для вывода типов: имена измерений. */
    readonly '~dimensions': Dimensions;

    title(title: string): RegisterBuilder<Name, Fields, Dimensions>;

    /** Измерение: разрез, по которому отбирают и группируют строки. */
    dimension<const FieldName extends string, Field extends AnyFieldBuilder>(
        name: AvailableFieldName<FieldName, 'register', Fields>,
        define: (field: FieldFactory) => Field,
    ): RegisterBuilder<Name, Fields & { readonly [K in FieldName]: Field }, Dimensions | FieldName>;

    /** Ресурс: число или деньги, которые суммируются. */
    resource<const FieldName extends string, Field extends ResourceFieldBuilder>(
        name: AvailableFieldName<FieldName, 'register', Fields>,
        define: (field: FieldFactory) => Field,
    ): RegisterBuilder<Name, Fields & { readonly [K in FieldName]: Field }, Dimensions>;

    /**
     * Ограничение итога: сумма ресурса по сочетанию значений измерений не может стать меньше
     * заданного значения. Платформа проверяет его после каждого изменения движений документа
     * и при нарушении отменяет транзакцию. Ограничений может быть несколько, их имена не повторяются.
     * Объявляется после измерений и ресурсов, которые в нём названы.
     *
     * `By` выводится из результата `define`: ограничение может считать итог по части измерений
     * регистра, а билдеры с разными наборами измерений друг другу не присваиваются.
     */
    constraint<By extends Dimensions>(
        name: string,
        define: (constraint: RegisterConstraintBuilder<Fields, Dimensions>) => RegisterConstraintBuilder<Fields, Dimensions, By>,
    ): RegisterBuilder<Name, Fields, Dimensions>;
}

/**
 * Строка движения регистра в том виде, в каком её возвращает обработчик проведения: измерения
 * и ресурсы регистра. `period` можно не указывать — тогда платформа подставит дату документа.
 * Регистратор и номер строки платформа заполняет сама.
 */
export type MovementOf<Fields extends FieldMap> = Simplify<FieldsRecord<Fields> & { readonly period?: string }>;

/**
 * Связывает строки движений с регистром для обработчика проведения. Тип строки выводится из
 * билдера регистра, поэтому TypeScript отклоняет неизвестные измерения и ресурсы.
 */
export function movements<Name extends string, Fields extends FieldMap, Dimensions extends string>(
    register: RegisterBuilder<Name, Fields, Dimensions>,
    rows: ReadonlyArray<MovementOf<Fields>>,
): RegisterMovements {
    return { register: register.name, rows };
}

/**
 * Единая реализация билдеров всех видов. Набор методов ограничивают интерфейсы вида объекта,
 * через которые реализация видна снаружи; сама она содержит методы всех видов.
 */
class ObjectBuilderImplementation {
    /** Только для вывода типов: во время выполнения свойств нет. */
    declare readonly '~fields': FieldMap;
    declare readonly '~tableParts': TablePartMap;
    declare readonly '~actions': string;
    readonly '~state': ObjectState;

    constructor(state: ObjectState) {
        this['~state'] = state;
    }

    get kind(): ObjectKind {
        return this['~state'].kind;
    }

    get name(): string {
        return this['~state'].name;
    }

    title(title: string): this {
        return this.with({ title });
    }

    field(name: string, define: (field: FieldFactory) => AnyFieldBuilder): this {
        return this.with({ fields: [...this['~state'].fields, attribute(name, define)] });
    }

    dimension(name: string, define: (field: FieldFactory) => AnyFieldBuilder): this {
        const entry = attribute(name, define, 'dimension');
        return this.with({ fields: [...this['~state'].fields, this.kind === 'informationRegister'
            ? { ...entry, builder: entry.builder.required() } : entry] });
    }

    resource(name: string, define: (field: FieldFactory) => AnyFieldBuilder): this {
        return this.with({ fields: [...this['~state'].fields, attribute(name, define, 'resource')] });
    }

    tablePart(name: string, define: (part: TablePartBuilder) => TablePartBuilder<FieldMap>): this {
        const part = define(new TablePartBuilder());
        return this.with({ tableParts: [...this['~state'].tableParts, { name, title: part['~title'], fields: part['~entries'] }] });
    }

    action(name: string, define: (action: ActionBuilder) => ActionBuilder<FieldMap, TablePartMap>): this {
        const action = define(new ActionBuilder());
        const entry: ActionEntry = {
            name, title: action['~title'], input: action['~entries'], tableParts: action['~parts'], handler: action['~handler'],
            placement: action['~placement'], confirmation: action['~confirmation'],
        };
        return this.with({ actions: [...this['~state'].actions, entry] });
    }

    form(define: (form: FormBuilder<string>) => FormBuilder<string>): this {
        return this.with({ form: define(new FormBuilder())['~overrides'] });
    }

    policy(policy: Policy<never>): this {
        const description: PolicyDescription = {
            name: policy.name,
            save: policy.save ?? null,
            post: policy.post ?? null,
            unpost: policy.unpost ?? null,
            markDeleted: policy.markDeleted ?? null,
            unmarkDeleted: policy.unmarkDeleted ?? null,
            delete: policy.delete ?? null,
        };
        return this.with({ policies: [...this['~state'].policies, description] });
    }

    presentation(value: string | ReadonlyArray<PresentationPart>): this {
        return this.with(typeof value === 'string' ? { presentation: value, presentationParts: [] } : { presentation: null, presentationParts: value });
    }

    listTableParts(names: ReadonlyArray<string>): this { return this.with({ listTableParts: names }); }

    lookup(define: (lookup: LookupBuilder) => LookupBuilder<FieldMap>): this {
        return this.with({ lookup: define(new LookupBuilder())['~entry'] });
    }

    posting(handler: PostingHandler<never>): this {
        return this.with({ posting: handler });
    }

    constraint(name: string, define: (constraint: RegisterConstraintBuilder<FieldMap, string>) => RegisterConstraintBuilder<FieldMap, string, string>): this {
        const constraint = define(new RegisterConstraintBuilder({ name, by: [], resource: null, minimum: null, message: null }));
        return this.with({ constraints: [...this['~state'].constraints, constraint['~entry']] });
    }

    withStandardFields(): this {
        if (this['~state'].standardFieldsAdded) return this;
        const standard: ReadonlyArray<FieldEntry> = Object.entries(standardFields[this.kind]).map(([name, builder]) => ({
            name,
            role: 'standard',
            managed: managedStandardFields.has(name),
            builder,
        }));
        return this.with({ fields: [...standard, ...this['~state'].fields], standardFieldsAdded: true });
    }

    commit(configuration: ReadonlyArray<ObjectBuilder>, formElements: ReadonlySet<string> = new Set()): Effect.Effect<ObjectDescription, MetadataError> {
        return commitObject(this['~state'], configuration, formElements);
    }

    /** Возвращает новый билдер с изменённым состоянием, не трогая текущий. */
    private with(patch: Partial<ObjectState>): this {
        return new ObjectBuilderImplementation({ ...this['~state'], ...patch }) as this;
    }
}

/**
 * Проверяет, что значение — билдер объекта. Нужна реестру конфигурации: экспорт файла
 * конфигурации известен только во время выполнения, и кроме билдера файл может экспортировать
 * вспомогательные значения.
 */
export function isObjectBuilder(value: unknown): value is ObjectBuilder {
    return value instanceof ObjectBuilderImplementation;
}

function emptyState(kind: ObjectKind, name: string): ObjectState {
    return { kind, name, title: null, fields: [], tableParts: [], actions: [], form: null, policies: [], presentation: null, presentationParts: [], listTableParts: [], posting: null, constraints: [], lookup: null, standardFieldsAdded: false };
}

// Функции ниже приводят реализацию к интерфейсу через unknown: точные типы полей существуют
// только на уровне типов и накапливаются в интерфейсе, у класса их нет.

/** Справочник: условно-постоянные данные. */
export function catalog<const Name extends string>(name: Name): CatalogBuilder<Name, {}, {}> {
    return new ObjectBuilderImplementation(emptyState('catalog', name)) as unknown as CatalogBuilder<Name, {}, {}>;
}

/** Документ: событие с датой, номером и признаком проведения. */
export function document<const Name extends string>(name: Name): DocumentBuilder<Name, {}, {}> {
    return new ObjectBuilderImplementation(emptyState('document', name)) as unknown as DocumentBuilder<Name, {}, {}>;
}

/** Регистр оборотов: строки, которые документы записывают при проведении. */
export function register<const Name extends string>(name: Name): RegisterBuilder<Name, {}> {
    return new ObjectBuilderImplementation(emptyState('register', name)) as unknown as RegisterBuilder<Name, {}>;
}

/** Независимый непериодический регистр: значения ресурсов по уникальному набору измерений. */
export function informationRegister<const Name extends string>(name: Name): InformationRegisterBuilder<Name, {}> {
    return new ObjectBuilderImplementation(emptyState('informationRegister', name)) as unknown as InformationRegisterBuilder<Name, {}>;
}
