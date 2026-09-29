import type { Effect } from 'effect';
import { commitObject } from './commit.js';
import type { FieldRole, FormOverride, ObjectDescription, ObjectKind, PolicyDescription } from './descriptions.js';
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

// ---------------------------------------------------------------------------
// Внутреннее состояние билдеров

export interface FieldEntry {
    readonly name: string;
    readonly role: FieldRole;
    readonly managed: boolean;
    readonly builder: AnyFieldBuilder;
}

export interface TablePartEntry {
    readonly name: string;
    readonly title: string | null;
    readonly fields: ReadonlyArray<FieldEntry>;
}

export interface ActionEntry {
    readonly name: string;
    readonly title: string | null;
    readonly input: ReadonlyArray<FieldEntry>;
    readonly handler: ((input: never) => unknown) | null;
}

export interface ObjectState {
    readonly kind: ObjectKind;
    readonly name: string;
    readonly title: string | null;
    readonly fields: ReadonlyArray<FieldEntry>;
    readonly tableParts: ReadonlyArray<TablePartEntry>;
    readonly actions: ReadonlyArray<ActionEntry>;
    readonly form: ReadonlyArray<FormOverride> | null;
    readonly policies: ReadonlyArray<PolicyDescription>;
    readonly standardFieldsAdded: boolean;
}

function attribute(name: string, define: (field: FieldFactory) => AnyFieldBuilder, role: FieldRole = 'attribute'): FieldEntry {
    return { name, role, managed: false, builder: define(fieldFactory) };
}

// ---------------------------------------------------------------------------
// Типы записей

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

// ---------------------------------------------------------------------------
// Вложенные билдеры

/** Билдер табличной части. */
export class TablePartBuilder<Fields extends FieldMap = {}> {
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

/** Билдер входных данных собственного действия. */
export class ActionInputBuilder<Fields extends FieldMap = {}> {
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
 * Обработчик собственного действия. Заготовка: окружение и контекст действия
 * уточнит диспетчер (#6).
 */
export type ActionHandler<Input> = (input: Input) => Effect.Effect<unknown, unknown, unknown>;

/** Билдер собственного действия. Выполнение действий реализует диспетчер (#6). */
export class ActionBuilder<Input extends FieldMap = {}> {
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

    /** Поля входных данных. Заменяет ранее объявленные; обработчик нужно задать после них. */
    input<Fields extends FieldMap>(define: (input: ActionInputBuilder) => ActionInputBuilder<Fields>): ActionBuilder<Fields> {
        return new ActionBuilder(this['~title'], define(new ActionInputBuilder())['~entries'], null);
    }

    handle(handler: ActionHandler<FieldsRecord<Input>>): ActionBuilder<Input> {
        return new ActionBuilder(this['~title'], this['~entries'], handler);
    }
}

/** Переопределение формы по умолчанию. Применяет билдер описаний форм (#11). */
export class FormBuilder<Names extends string> {
    readonly '~overrides': ReadonlyArray<FormOverride>;

    constructor(overrides: ReadonlyArray<FormOverride> = []) {
        this['~overrides'] = overrides;
    }

    /** Группа полей с заголовком. */
    group(title: string, fields: ReadonlyArray<Names>): FormBuilder<Names> {
        return new FormBuilder([...this['~overrides'], { kind: 'group', title, fields }]);
    }

    /** Скрыть поле или табличную часть. */
    hide(field: Names): FormBuilder<Names> {
        return new FormBuilder([...this['~overrides'], { kind: 'hide', field }]);
    }

    /** Подпись поля или табличной части на форме. */
    title(field: Names, title: string): FormBuilder<Names> {
        return new FormBuilder([...this['~overrides'], { kind: 'title', field, title }]);
    }
}

/**
 * Политика записи. Заготовка: выполнение и способ отказа уточнит #10.
 * - `canWrite` — можно ли записать объект;
 * - `beforeWrite` — действия перед записью.
 */
export interface WritePolicy<Record> {
    readonly canWrite?: (record: Record) => Effect.Effect<boolean, unknown, unknown>;
    readonly beforeWrite?: (record: Record) => Effect.Effect<unknown, unknown, unknown>;
}

// ---------------------------------------------------------------------------
// Билдеры объектов

/** Общая часть билдеров всех видов объектов. */
export interface ObjectBuilder<Kind extends ObjectKind = ObjectKind, Name extends string = string> {
    readonly kind: Kind;
    readonly name: Name;
    readonly '~fields': FieldMap;
    readonly '~tableParts': TablePartMap;
    readonly '~state': ObjectState;

    /**
     * Добавляет стандартные поля вида объекта перед объявленными. Вызывает сервис метаданных
     * перед `commit()`; повторный вызов ничего не меняет.
     */
    withStandardFields(): this;

    /**
     * Проверяет описание и собирает неизменяемое описание объекта.
     * `configuration` — все объекты конфигурации: по ним проверяются ссылки.
     */
    commit(configuration: ReadonlyArray<ObjectBuilder>): Effect.Effect<ObjectDescription, MetadataError>;
}

/** Билдер справочника или документа. */
export interface RecordObjectBuilder<
    Kind extends 'catalog' | 'document',
    Name extends string,
    Fields extends FieldMap,
    Parts extends TablePartMap,
> extends ObjectBuilder<Kind, Name> {
    readonly '~fields': Fields;
    readonly '~tableParts': Parts;

    title(title: string): RecordObjectBuilder<Kind, Name, Fields, Parts>;

    field<const FieldName extends string, Field extends AnyFieldBuilder>(
        name: FieldName,
        define: (field: FieldFactory) => Field,
    ): RecordObjectBuilder<Kind, Name, Fields & { readonly [K in FieldName]: Field }, Parts>;

    tablePart<const PartName extends string, PartFields extends FieldMap>(
        name: PartName,
        define: (part: TablePartBuilder) => TablePartBuilder<PartFields>,
    ): RecordObjectBuilder<Kind, Name, Fields, Parts & { readonly [K in PartName]: PartFields }>;

    /** Собственное действие. Выполнение реализует диспетчер (#6). */
    action<Input extends FieldMap>(
        name: string,
        define: (action: ActionBuilder) => ActionBuilder<Input>,
    ): RecordObjectBuilder<Kind, Name, Fields, Parts>;

    /** Переопределение формы. Повторный вызов заменяет предыдущее. */
    form(
        define: (form: FormBuilder<FieldNames<Kind, Fields> | keyof Parts & string>) => FormBuilder<FieldNames<Kind, Fields> | keyof Parts & string>,
    ): RecordObjectBuilder<Kind, Name, Fields, Parts>;

    /** Политика записи. Политики из нескольких вызовов выполняются по порядку. */
    policy(policy: WritePolicy<ObjectRecord<Kind, Fields, Parts>>): RecordObjectBuilder<Kind, Name, Fields, Parts>;
}

export type CatalogBuilder<Name extends string, Fields extends FieldMap, Parts extends TablePartMap> = RecordObjectBuilder<'catalog', Name, Fields, Parts>;

export type DocumentBuilder<Name extends string, Fields extends FieldMap, Parts extends TablePartMap> = RecordObjectBuilder<'document', Name, Fields, Parts>;

/** Ресурс регистра — число или деньги: их суммируют при расчёте оборотов. */
type ResourceFieldBuilder = NumberFieldBuilder | MoneyFieldBuilder;

/** Билдер регистра оборотов. Строки регистра записывают документы при проведении. */
export interface RegisterBuilder<Name extends string, Fields extends FieldMap> extends ObjectBuilder<'register', Name> {
    readonly '~fields': Fields;
    readonly '~tableParts': {};

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

/** Единая реализация билдеров; наружу она видна через интерфейсы вида объекта. */
class ObjectBuilderImplementation {
    declare readonly '~fields': FieldMap;
    declare readonly '~tableParts': TablePartMap;
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

    private with(patch: Partial<ObjectState>): this {
        return new ObjectBuilderImplementation({ ...this['~state'], ...patch }) as this;
    }
}

function emptyState(kind: ObjectKind, name: string): ObjectState {
    return { kind, name, title: null, fields: [], tableParts: [], actions: [], form: null, policies: [], standardFieldsAdded: false };
}

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
