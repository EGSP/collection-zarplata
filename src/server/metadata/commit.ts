import { Effect } from 'effect';
import type { FieldEntry, ObjectBuilder, ObjectState } from './builders.js';
import type {
    ActionDescription,
    FieldDescription,
    ObjectDescription,
    ObjectKind,
    ObjectTarget,
    TablePartDescription,
} from './descriptions.js';
import { MetadataError, type MetadataProblem } from './metadata.errors.js';
import { checkName } from './names.js';
import { standardFields } from './standard-fields.js';

/** Стандартные действия платформы: собственное действие не может называться так же. */
const standardActions: ReadonlySet<string> = new Set(['list', 'get', 'save', 'markDeleted', 'unmarkDeleted', 'post', 'unpost']);

const kindTitles: { readonly [Kind in ObjectKind]: string } = {
    catalog: 'справочник',
    document: 'документ',
    register: 'регистр',
};

/** Список проблем одного объекта. */
class Problems {
    readonly items: Array<MetadataProblem> = [];

    constructor(private readonly object: string) {}

    add(location: string | null, message: string): void {
        this.items.push({ object: this.object, location, message });
    }
}

function objectLabel(object: { readonly kind: ObjectKind; readonly name: string }): string {
    return `${object.kind} ${object.name}`;
}

function checkBounds(field: FieldDescription, location: string, problems: Problems): void {
    const { minimumLength, maximumLength, minimum, maximum } = field;
    for (const [bound, value] of [['минимальная длина', minimumLength], ['максимальная длина', maximumLength]] as const) {
        if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
            problems.add(location, `${bound} должна быть неотрицательным целым числом, получено ${value}`);
        }
    }
    if (minimumLength !== null && maximumLength !== null && minimumLength > maximumLength) {
        problems.add(location, `минимальная длина ${minimumLength} больше максимальной ${maximumLength}`);
    }
    for (const [bound, value] of [['нижняя граница', minimum], ['верхняя граница', maximum]] as const) {
        if (value === null) continue;
        if (!Number.isFinite(value)) {
            problems.add(location, `${bound} должна быть конечным числом, получено ${value}`);
        } else if (field.integer && !Number.isSafeInteger(value)) {
            problems.add(location, `${bound} поля с целыми значениями должна быть целым числом, получено ${value}`);
        }
    }
    if (minimum !== null && maximum !== null && minimum > maximum) {
        problems.add(location, `нижняя граница ${minimum} больше верхней ${maximum}`);
    }
}

function resolveTarget(entry: FieldEntry, location: string, problems: Problems, configuration: ReadonlyArray<ObjectBuilder>): ObjectTarget | null {
    const target = entry.builder['~state'].target;
    if (target === null) {
        problems.add(location, 'не указан объект, на который ссылается поле');
        return null;
    }
    let resolved: ObjectTarget | undefined;
    try {
        resolved = typeof target === 'function' ? target() : target;
    } catch (cause) {
        problems.add(location, `не удалось получить объект ссылки: ${String(cause)}`);
        return null;
    }
    // Функция может вернуть undefined, если билдер ещё не инициализирован из-за циклического импорта.
    if (resolved === undefined || resolved === null) {
        problems.add(location, 'объект ссылки не определён; при циклическом импорте передайте функцию: field.reference(() => Объект)');
        return null;
    }
    const { kind, name } = resolved;
    if (kind !== 'catalog' && kind !== 'document') {
        problems.add(location, `ссылаться можно только на справочник или документ, указан ${kindTitles[kind as ObjectKind] ?? kind} «${name}»`);
        return null;
    }
    if (!configuration.some((object) => object.kind === kind && object.name === name)) {
        problems.add(location, `ссылка на несуществующий объект: ${kindTitles[kind]} «${name}» не найден в конфигурации`);
    }
    return { kind, name };
}

/** Проверяет и описывает набор полей: реквизиты объекта, строки табличной части или входные данные действия. */
function describeFields(
    entries: ReadonlyArray<FieldEntry>,
    prefix: string,
    problems: Problems,
    configuration: ReadonlyArray<ObjectBuilder>,
): ReadonlyArray<FieldDescription> {
    const seen = new Map<string, FieldEntry>();
    return entries.map((entry) => {
        const location = `${prefix}поле ${entry.name}`;
        const nameProblem = checkName(entry.name);
        if (nameProblem !== null) problems.add(location, nameProblem);
        const previous = seen.get(entry.name);
        if (previous !== undefined) {
            problems.add(
                location,
                previous.role === 'standard' ? `имя совпадает со стандартным полем «${entry.name}»` : `имя поля «${entry.name}» повторяется`,
            );
        }
        seen.set(entry.name, entry);

        const state = entry.builder['~state'];
        const description: FieldDescription = {
            name: entry.name,
            kind: state.kind,
            role: entry.role,
            title: state.title ?? entry.name,
            required: state.required,
            managed: entry.managed,
            minimumLength: state.minimumLength,
            maximumLength: state.maximumLength,
            minimum: state.minimum,
            maximum: state.maximum,
            integer: state.integer,
            target: state.kind === 'reference' ? resolveTarget(entry, location, problems, configuration) : null,
        };
        checkBounds(description, location, problems);
        return description;
    });
}

function freeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        for (const item of Object.values(value)) freeze(item);
        Object.freeze(value);
    }
    return value;
}

/** Проверяет состояние билдера. Возвращает описание, если проблем нет. */
function validateObject(
    state: ObjectState,
    configuration: ReadonlyArray<ObjectBuilder>,
): { readonly problems: ReadonlyArray<MetadataProblem>; readonly description: ObjectDescription } {
    const problems = new Problems(objectLabel(state));

    const nameProblem = checkName(state.name);
    if (nameProblem !== null) problems.add(null, nameProblem);
    if (!state.standardFieldsAdded) {
        problems.add(null, 'стандартные поля не добавлены: вызовите withStandardFields() перед commit()');
    }

    const fields = describeFields(state.fields, '', problems, configuration);
    if (state.kind === 'register' && !fields.some((field) => field.role === 'resource')) {
        problems.add(null, 'у регистра нет ни одного ресурса');
    }

    // Стандартные поля учитываются и до withStandardFields(), чтобы не дублировать ошибку в проверке формы.
    const fieldNames = new Set([...Object.keys(standardFields[state.kind]), ...fields.map((field) => field.name)]);
    const partNames = new Set<string>();
    const tableParts = state.tableParts.map((part): TablePartDescription => {
        const location = `табличная часть ${part.name}`;
        const partNameProblem = checkName(part.name);
        if (partNameProblem !== null) problems.add(location, partNameProblem);
        if (partNames.has(part.name)) problems.add(location, `имя табличной части «${part.name}» повторяется`);
        if (fieldNames.has(part.name)) problems.add(location, `имя табличной части совпадает с именем поля «${part.name}»`);
        partNames.add(part.name);
        if (part.fields.length === 0) problems.add(location, 'в табличной части нет полей');
        return {
            name: part.name,
            title: part.title ?? part.name,
            fields: describeFields(part.fields, `${location}, `, problems, configuration),
        };
    });

    const actionNames = new Set<string>();
    const actions = state.actions.map((action): ActionDescription => {
        const location = `действие ${action.name}`;
        const actionNameProblem = checkName(action.name);
        if (actionNameProblem !== null) problems.add(location, actionNameProblem);
        if (standardActions.has(action.name)) problems.add(location, `имя совпадает со стандартным действием «${action.name}»`);
        if (actionNames.has(action.name)) problems.add(location, `имя действия «${action.name}» повторяется`);
        actionNames.add(action.name);
        if (action.handler === null) problems.add(location, 'не задан обработчик: вызовите handle(...)');
        return {
            name: action.name,
            title: action.title ?? action.name,
            input: describeFields(action.input, `${location}, `, problems, configuration),
            handler: action.handler,
        };
    });

    if (state.form !== null) {
        for (const override of state.form) {
            const names = override.kind === 'group' ? override.fields : [override.field];
            for (const name of names) {
                if (!fieldNames.has(name) && !partNames.has(name)) {
                    problems.add('форма', `нет поля или табличной части «${name}»`);
                }
            }
        }
    }

    const description: ObjectDescription = {
        kind: state.kind,
        name: state.name,
        title: state.title ?? state.name,
        fields,
        tableParts,
        actions,
        form: state.form === null ? null : { overrides: state.form },
        policies: state.policies,
    };
    return { problems: problems.items, description };
}

/** Реализация `commit()` билдера. */
export function commitObject(state: ObjectState, configuration: ReadonlyArray<ObjectBuilder>): Effect.Effect<ObjectDescription, MetadataError> {
    return Effect.suspend(() => {
        const { problems, description } = validateObject(state, configuration);
        return problems.length > 0 ? Effect.fail(new MetadataError({ problems })) : Effect.succeed(freeze(description));
    });
}

/**
 * Собирает описания всех объектов конфигурации. Кроме проверок каждого объекта проверяет,
 * что имена объектов одного вида не повторяются. Ошибка перечисляет проблемы всех объектов.
 */
export function commitConfiguration(configuration: ReadonlyArray<ObjectBuilder>): Effect.Effect<ReadonlyArray<ObjectDescription>, MetadataError> {
    return Effect.suspend(() => {
        const problems: Array<MetadataProblem> = [];
        const seen = new Set<string>();
        const descriptions = configuration.map((builder) => {
            const label = objectLabel(builder);
            if (seen.has(label)) {
                problems.push({ object: label, location: null, message: `${kindTitles[builder.kind]} с именем «${builder.name}» объявлен дважды` });
            }
            seen.add(label);
            const result = validateObject(builder['~state'], configuration);
            problems.push(...result.problems);
            return result.description;
        });
        return problems.length > 0 ? Effect.fail(new MetadataError({ problems })) : Effect.succeed(freeze(descriptions));
    });
}
