/**
 * Построение описаний форм и списков из описаний объектов конфигурации.
 *
 * Описания строятся из тех же метаданных, что и таблицы базы и схемы проверки входных данных,
 * поэтому набор полей, их виды и правила проверки на форме совпадают с тем, что примет сервер.
 * Переопределения формы из конфигурации применяются здесь, и клиент получает готовую раскладку.
 * Проверку переопределений (существование имён, однозначность групп) уже выполнил `commit()`,
 * поэтому построение не завершается ошибкой.
 */
import { readRight, requiredRight, type Right } from '../authorization/rights.js';
import type { FieldDescription, FormOverride, ObjectDescription, RecordOpeningMode } from '../metadata/descriptions.js';
import { formHiddenStandardFields } from '../metadata/standard-fields.js';
import {
    filterOperators,
    type FormAction,
    type FormField,
    type FormGroup,
    type FormTablePart,
    type FormView,
    type ListColumn,
    type ListFilter,
    type ListSort,
    type ListView,
    type ObjectView,
} from './descriptions.js';

/** Стандартные действия формы по видам объектов в порядке показа. `list` и `get` форма выполняет сама. */
const standardFormActions: { readonly [Kind in 'catalog' | 'document']: ReadonlyArray<{ readonly name: string; readonly title: string }> } = {
    catalog: [
        { name: 'save', title: 'Записать' },
        { name: 'markDeleted', title: 'Пометить на удаление' },
        { name: 'unmarkDeleted', title: 'Снять пометку удаления' },
    ],
    document: [
        { name: 'save', title: 'Записать' },
        { name: 'post', title: 'Провести' },
        { name: 'unpost', title: 'Отменить проведение' },
        { name: 'markDeleted', title: 'Пометить на удаление' },
        { name: 'unmarkDeleted', title: 'Снять пометку удаления' },
    ],
};

/**
 * Сортировка при открытии списка по видам объектов. Документы и строки регистра показываются
 * от новых к старым: обычно нужны последние записи.
 */
const defaultSorts: { readonly [Kind in ObjectDescription['kind']]: ReadonlyArray<ListSort> } = {
    informationRegister: [],
    catalog: [{ field: 'name', direction: 'ascending' }],
    document: [
        { field: 'date', direction: 'descending' },
        { field: 'number', direction: 'descending' },
    ],
    register: [
        { field: 'period', direction: 'descending' },
        { field: 'lineNumber', direction: 'ascending' },
    ],
};

/**
 * Поле формы из описания поля. `title` и `inputElement` передаются отдельно, потому что их задаёт
 * переопределение формы: подпись и собственный элемент на месте поля ввода.
 */
function formField(field: FieldDescription, title: string = field.title, inputElement: string | null = null): FormField {
    return {
        inputElement,
        name: field.name,
        title,
        kind: field.kind,
        target: field.target,
        choices: field.choices,
        readOnly: field.managed,
        rules: {
            required: field.required,
            minimumLength: field.minimumLength,
            maximumLength: field.maximumLength,
            minimum: field.minimum,
            maximum: field.maximum,
            integer: field.integer,
        },
    };
}

/**
 * Раскладка формы: объявленные группы в порядке объявления, затем группа без заголовка
 * с оставшимися элементами. Без переопределений получается одна группа без заголовка.
 */
function layout(elements: ReadonlyArray<string>, overrides: ReadonlyArray<FormOverride>): ReadonlyArray<FormGroup> {
    const visible = new Set(elements);
    const groups: Array<FormGroup> = [];
    const placed = new Set<string>();
    for (const override of overrides) {
        if (override.kind !== 'group') continue;
        // Собственный элемент скрыть нельзя, поэтому он остаётся в группе всегда.
        const groupElements = override.fields.filter((item) => typeof item !== 'string' || visible.has(item));
        for (const item of groupElements) {
            if (typeof item === 'string') placed.add(item);
        }
        groups.push({ title: override.title, elements: groupElements });
    }
    const rest = elements.filter((name) => !placed.has(name));
    if (rest.length > 0) groups.push({ title: null, elements: rest });
    return groups;
}

/** Описание формы справочника или документа с учётом переопределений. */
export function buildForm(object: ObjectDescription & { readonly kind: 'catalog' | 'document' }): FormView {
    const overrides = object.form?.overrides ?? [];
    const hidden = new Set(formHiddenStandardFields);
    const titles = new Map<string, string>();
    const inputs = new Map<string, string>();
    let creationMode: RecordOpeningMode = 'tab';
    for (const override of overrides) {
        if (override.kind === 'hide') hidden.add(override.field);
        if (override.kind === 'title') titles.set(override.field, override.title);
        if (override.kind === 'input') inputs.set(override.field, override.element);
        if (override.kind === 'creation') creationMode = override.mode;
    }

    const fields = object.fields
        .filter((field) => !hidden.has(field.name))
        .map((field) => formField(field, titles.get(field.name) ?? field.title, inputs.get(field.name) ?? null));
    const tableParts: ReadonlyArray<FormTablePart> = object.tableParts
        .filter((part) => !hidden.has(part.name))
        .map((part) => ({ name: part.name, title: titles.get(part.name) ?? part.title, columns: part.fields.map((field) => formField(field)) }));

    // Табличные части идут после полей: на форме они занимают всю ширину и обычно стоят внизу.
    const groups = layout([...fields.map((field) => field.name), ...tableParts.map((part) => part.name)], overrides);
    const readOnly = new Set(fields.filter((field) => field.readOnly).map((field) => field.name));
    // Собственный элемент в группе остановкой обхода не служит: контракта поля ввода он не обязан соблюдать.
    const traversal = groups
        .flatMap((group) => group.elements)
        .filter((item) => typeof item === 'string')
        .filter((name) => !readOnly.has(name));

    const actions: ReadonlyArray<FormAction> = [
        ...standardFormActions[object.kind].map((action) => ({ ...action, standard: true, input: [] })),
        ...object.actions.map((action) => ({
            name: action.name,
            title: action.title,
            standard: false,
            input: action.input.map((field) => formField(field)),
        })),
    ];

    return { fields, tableParts, groups, traversal, actions, creationMode };
}

/**
 * Описание списка. Колонками выводятся все поля записи, кроме стандартных `guid` и пометки удаления:
 * пометку клиент показывает признаком строки. Переопределение формы на список не влияет.
 */
export function buildList(object: ObjectDescription): ListView {
    const fields = object.fields.filter((field) => field.role !== 'standard' || !formHiddenStandardFields.has(field.name));
    const columns: ReadonlyArray<ListColumn> = fields.map((field) => ({
        field: field.name, title: field.title, kind: field.kind, target: field.target,
        choices: field.choices, role: field.role,
    }));
    const filters: ReadonlyArray<ListFilter> = fields.map((field) => ({
        field: field.name, title: field.title, kind: field.kind, target: field.target,
        choices: field.choices, operators: filterOperators[field.kind],
    }));
    // Регистратор состоит из двух значений, и порядок по нему ничего не говорит пользователю.
    const sortable = fields.filter((field) => field.kind !== 'recorder').map((field) => field.name);
    return {
        columns,
        filters,
        sortable,
        defaultSort: object.kind === 'informationRegister'
            ? fields.filter((field) => field.role === 'dimension').map((field) => ({ field: field.name, direction: 'ascending' }))
            : defaultSorts[object.kind],
        deletionMark: object.fields.some((field) => field.role === 'standard' && field.name === 'deletedAt'),
    };
}

/** Описание объекта для клиента: форма (у регистров её нет) и список. */
export function buildObjectView(object: ObjectDescription): ObjectView {
    return {
        kind: object.kind,
        name: object.name,
        title: object.title,
        presentation: object.presentation,
        form: object.kind === 'catalog' || object.kind === 'document' ? buildForm({ ...object, kind: object.kind }) : null,
        list: buildList(object),
    };
}

/**
 * Описание объекта для пользователя с учётом его прав. Возвращает `null`, если у пользователя
 * нет права чтения: такой объект клиенту не показывается вовсе. Из действий формы остаются
 * только те, которые диспетчер примет от этого пользователя: право для действия определяет та же
 * функция, что и в диспетчере. Форма без действия `save` доступна только для просмотра.
 */
export function restrictObjectView(object: ObjectDescription, view: ObjectView, allows: (right: Right) => boolean): ObjectView | null {
    if (!allows(readRight(object))) return null;
    if (view.form === null) return view;
    const actions = view.form.actions.filter((action) => {
        const right = requiredRight(object, action.name);
        return right !== undefined && allows(right);
    });
    return { ...view, form: { ...view.form, actions } };
}
