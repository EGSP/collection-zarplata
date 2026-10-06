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
import type { Effect } from 'effect';
import { commitObject } from './commit.js';
import type { FieldRole, FormOverride, ObjectDescription, ObjectKind, PolicyDescription, RegisterMovements } from './descriptions.js';
import {
    fieldFactory,
    type AnyFieldBuilder,
    type FieldFactory,
    type FieldMap,
    type FieldsRecord,
    type MoneyFieldBuilder,
    type NumberFieldBuilder,
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
    readonly handler: ((input: never) => unknown) | null;
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
    /** Обработчик проведения; задаётся только у документа. */
    readonly posting: ((record: never) => unknown) | null;
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

/** Имена полей объекта, включая стандартные. */
type FieldNames<Kind extends ObjectKind, Fields extends FieldMap> = keyof StandardFields[Kind] & string | keyof Fields & string;

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

    title(title: string): TablePartBuilder<Fields> {
        return new TablePartBuilder(title, this['~entries']);
    }

    field<const Name extends string, Field extends AnyFieldBuilder>(
        name: Name,
        define: (field: FieldFactory) => Field,
    ): TablePartBuilder<Fields & { readonly [K in Name]: Field }> {
        return new TablePartBuilder(this['~title'], [...this['~entries'], attribute(name, define)]);
    }
}

/** Билдер входных данных собственного действия. Поля объявляются так же, как поля объекта. */
export class ActionInputBuilder<Fields extends FieldMap = {}> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~fields': Fields;
    readonly '~entries': ReadonlyArray<FieldEntry>;

    constructor(entries: ReadonlyArray<FieldEntry> = []) {
        this['~entries'] = entries;
    }

    field<const Name extends string, Field extends AnyFieldBuilder>(
        name: Name,
        define: (field: FieldFactory) => Field,
    ): ActionInputBuilder<Fields & { readonly [K in Name]: Field }> {
        return new ActionInputBuilder([...this['~entries'], attribute(name, define)]);
    }
}

/**
 * Обработчик собственного действия получает проверенные входные данные и возвращает Effect.
 * Его ошибки прерывают всю транзакцию запроса. Через окружение ему доступны контекст действия,
 * диспетчер вложенных вызовов и база данных.
 */
export type ActionHandler<Input> = (input: Input) => Effect.Effect<unknown, unknown, unknown>;

/** Билдер собственного действия; обработчик вызывается диспетчером после проверки данных. */
export class ActionBuilder<Input extends FieldMap = {}> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~input': Input;
    readonly '~title': string | null;
    readonly '~entries': ReadonlyArray<FieldEntry>;
    readonly '~handler': ((input: never) => unknown) | null;

    constructor(title: string | null = null, entries: ReadonlyArray<FieldEntry> = [], handler: ((input: never) => unknown) | null = null) {
        this['~title'] = title;
        this['~entries'] = entries;
        this['~handler'] = handler;
    }

    title(title: string): ActionBuilder<Input> {
        return new ActionBuilder(title, this['~entries'], this['~handler']);
    }

    /**
     * Поля входных данных. Заменяет ранее объявленные и сбрасывает обработчик: тип его аргумента
     * выводится из полей, поэтому заданный раньше обработчик мог ожидать другие данные.
     */
    input<Fields extends FieldMap>(define: (input: ActionInputBuilder) => ActionInputBuilder<Fields>): ActionBuilder<Fields> {
        return new ActionBuilder(this['~title'], define(new ActionInputBuilder())['~entries'], null);
    }

    /** Обработчик действия; получает входные данные, проверенные по объявленным полям. */
    handle(handler: ActionHandler<FieldsRecord<Input>>): ActionBuilder<Input> {
        return new ActionBuilder(this['~title'], this['~entries'], handler);
    }
}

/**
 * Переопределение формы по умолчанию. `Names` — имена полей и табличных частей объекта,
 * поэтому TypeScript отклоняет несуществующие имена.
 *
 * По умолчанию форма — одна группа без заголовка: поля в порядке объявления, затем табличные
 * части. Группы выводятся в порядке объявления, а элементы, не попавшие ни в одну группу,
 * собираются после них в группу без заголовка. Порядок обхода с клавиатуры следует за раскладкой.
 */
export class FormBuilder<Names extends string> {
    readonly '~overrides': ReadonlyArray<FormOverride>;

    constructor(overrides: ReadonlyArray<FormOverride> = []) {
        this['~overrides'] = overrides;
    }

    /** Группа полей и табличных частей с заголовком; элементы выводятся и обходятся в указанном порядке. */
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
}

/** Политика записи объекта. Заготовка: порядок выполнения и способ отказа уточнит #10. */
export interface WritePolicy<Record> {
    /** Решает, можно ли записать объект в таком виде. */
    readonly canWrite?: (record: Record) => Effect.Effect<boolean, unknown, unknown>;
    /** Выполняется перед записью, например чтобы проверить связанные данные. */
    readonly beforeWrite?: (record: Record) => Effect.Effect<unknown, unknown, unknown>;
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
     * объектов конфигурации: без них нельзя проверить, что объект ссылки существует. При ошибках
     * завершается `MetadataError` со списком всех найденных проблем.
     */
    commit(configuration: ReadonlyArray<ObjectBuilder>): Effect.Effect<ObjectDescription, MetadataError>;
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

    /** Реквизит объекта. Имя и тип поля попадают в тип записи. */
    field<const FieldName extends string, Field extends AnyFieldBuilder>(
        name: FieldName,
        define: (field: FieldFactory) => Field,
    ): RecordBuilderOf<Kind, Name, Fields & { readonly [K in FieldName]: Field }, Parts, Actions>;

    /** Табличная часть; в записи она представлена массивом строк. */
    tablePart<const PartName extends string, PartFields extends FieldMap>(
        name: PartName,
        define: (part: TablePartBuilder) => TablePartBuilder<PartFields>,
    ): RecordBuilderOf<Kind, Name, Fields, Parts & { readonly [K in PartName]: PartFields }, Actions>;

    /** Собственное действие, доступное через единый эндпоинт. Имя попадает в тип билдера: по нему выводится право на действие. */
    action<const ActionName extends string, Input extends FieldMap>(
        name: ActionName,
        define: (action: ActionBuilder) => ActionBuilder<Input>,
    ): RecordBuilderOf<Kind, Name, Fields, Parts, Actions | ActionName>;

    /** Переопределение формы. Повторный вызов заменяет предыдущее. */
    form(
        define: (form: FormBuilder<FieldNames<Kind, Fields> | keyof Parts & string>) => FormBuilder<FieldNames<Kind, Fields> | keyof Parts & string>,
    ): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;

    /** Политика записи. Политики из нескольких вызовов выполняются по порядку. */
    policy(policy: WritePolicy<ObjectRecord<Kind, Fields, Parts>>): RecordBuilderOf<Kind, Name, Fields, Parts, Actions>;
}

/** Билдер справочника; его создаёт `catalog(name)`. */
export type CatalogBuilder<Name extends string, Fields extends FieldMap, Parts extends TablePartMap, Actions extends string = never> =
    RecordObjectBuilder<'catalog', Name, Fields, Parts, Actions>;

/**
 * Билдер того же вида, что и исходный. Методы общего интерфейса возвращают его, чтобы после
 * `.field(...)` у документа остался метод `.posting(...)`, которого нет у справочника.
 */
type RecordBuilderOf<Kind extends 'catalog' | 'document', Name extends string, Fields extends FieldMap, Parts extends TablePartMap, Actions extends string> =
    Kind extends 'document' ? DocumentBuilder<Name, Fields, Parts, Actions> : CatalogBuilder<Name, Fields, Parts, Actions>;

/**
 * Обработчик проведения получает сохранённую запись документа с табличными частями и возвращает
 * строки регистров, собранные функцией `movements(...)`. Через окружение ему доступны контекст
 * действия, диспетчер вложенных вызовов и база данных. Ошибка обработчика отменяет проведение
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

/** Билдер регистра оборотов. Строки регистра записывают документы при проведении. */
export interface RegisterBuilder<Name extends string, Fields extends FieldMap> extends ObjectBuilder<'register', Name> {
    readonly '~fields': Fields;
    readonly '~tableParts': {};
    /** У регистра нет собственных действий. */
    readonly '~actions': never;

    title(title: string): RegisterBuilder<Name, Fields>;

    /** Измерение: разрез, по которому отбирают и группируют строки. */
    dimension<const FieldName extends string, Field extends AnyFieldBuilder>(
        name: FieldName,
        define: (field: FieldFactory) => Field,
    ): RegisterBuilder<Name, Fields & { readonly [K in FieldName]: Field }>;

    /** Ресурс: число или деньги, которые суммируются. */
    resource<const FieldName extends string, Field extends ResourceFieldBuilder>(
        name: FieldName,
        define: (field: FieldFactory) => Field,
    ): RegisterBuilder<Name, Fields & { readonly [K in FieldName]: Field }>;
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
export function movements<Name extends string, Fields extends FieldMap>(
    register: RegisterBuilder<Name, Fields>,
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
        return this.with({ fields: [...this['~state'].fields, attribute(name, define, 'dimension')] });
    }

    resource(name: string, define: (field: FieldFactory) => AnyFieldBuilder): this {
        return this.with({ fields: [...this['~state'].fields, attribute(name, define, 'resource')] });
    }

    tablePart(name: string, define: (part: TablePartBuilder) => TablePartBuilder<FieldMap>): this {
        const part = define(new TablePartBuilder());
        return this.with({ tableParts: [...this['~state'].tableParts, { name, title: part['~title'], fields: part['~entries'] }] });
    }

    action(name: string, define: (action: ActionBuilder) => ActionBuilder<FieldMap>): this {
        const action = define(new ActionBuilder());
        const entry: ActionEntry = { name, title: action['~title'], input: action['~entries'], handler: action['~handler'] };
        return this.with({ actions: [...this['~state'].actions, entry] });
    }

    form(define: (form: FormBuilder<string>) => FormBuilder<string>): this {
        return this.with({ form: define(new FormBuilder())['~overrides'] });
    }

    policy(policy: WritePolicy<never>): this {
        const description: PolicyDescription = { canWrite: policy.canWrite ?? null, beforeWrite: policy.beforeWrite ?? null };
        return this.with({ policies: [...this['~state'].policies, description] });
    }

    posting(handler: PostingHandler<never>): this {
        return this.with({ posting: handler });
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

    commit(configuration: ReadonlyArray<ObjectBuilder>): Effect.Effect<ObjectDescription, MetadataError> {
        return commitObject(this['~state'], configuration);
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
    return { kind, name, title: null, fields: [], tableParts: [], actions: [], form: null, policies: [], posting: null, standardFieldsAdded: false };
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
