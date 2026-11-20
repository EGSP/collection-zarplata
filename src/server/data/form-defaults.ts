/** Подготовка начальных значений записи, строки и параметров действия. */
import { Effect } from 'effect';
import { accessDenied, currentAccess, dataLevel, type ExecutionAccess } from '../authorization/access-execution.js';
import { readRight, requiredRight } from '../authorization/rights.js';
import type { FieldDescription, ObjectDescription } from '../metadata/descriptions.js';
import { standardFieldDefault } from '../metadata/field-defaults.js';
import { fieldSchema } from '../metadata/schema.js';
import { editableFormFields } from '../ui/form-initial-values.js';
import { buildObjectView, restrictObjectView } from '../ui/views.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { objectValue, stringValue, validated, type RecordValue } from './records.js';

/** Проверяет, что пользователь вправе открыть новую запись или добавить строку объекта. */
function requireRecordWrite(object: ObjectDescription, access: ExecutionAccess) {
    const save = requiredRight(object, 'save');
    return save !== undefined && access.user.allows(save)
        ? Effect.void
        : Effect.fail(accessDenied(access, object, 'write', 'edit', 'deny'));
}

/** Поле должно быть доступно для изменения напрямую и не принадлежать внутренним данным. */
function editable(object: ObjectDescription, access: ExecutionAccess, field: string): boolean {
    return dataLevel(access, object, field, true) === 'edit' && !object.access?.entries.some(entry => {
        if (!entry.path.startsWith('internal.')) return false;
        const internal = entry.path.slice(9);
        return field === internal || field.startsWith(internal + '.');
    });
}

/** Вычисляет только незаданные значения. Обязательность проверяется позже, при записи или выполнении действия. */
const prepareValues = Effect.fnUntraced(function* (fields: readonly FieldDescription[], given: RecordValue = {}) {
    const values: RecordValue = {};
    for (const field of fields) {
        if (Object.hasOwn(given, field.name)) continue;
        const source = field.defaultValue;
        if (source?.kind === 'effect') {
            const value = yield* source.effect;
            values[field.name] = value === null ? null : yield* validated(fieldSchema(field), value, `default.${field.name}`);
        } else {
            values[field.name] = source === undefined ? standardFieldDefault(field.kind, field.required) : source.value;
        }
    }
    return values;
});

/** Собирает все поля новой записи и пустые части. Значения открытия могут включать поля вне раскладки. */
export const prepareNewRecord = Effect.fnUntraced(function* (object: ObjectDescription, payload: RecordValue) {
    const access = yield* currentAccess;
    if (!access.user.allows(readRight(object))) return yield* accessDenied(access, object, 'read', 'read', 'deny');
    yield* requireRecordWrite(object, access);
    const view = restrictObjectView(object, buildObjectView(object), right => access.user.allows(right), access.user)?.form;
    if (view == null) return yield* new DataNotFoundError({ message: `У объекта «${object.title}» нет формы новой записи` });

    const given = objectValue(payload['default'] === undefined ? {} : payload['default'], 'payload.default');
    const visible = new Set(editableFormFields(view).map(field => field.name));
    const fields = object.fields.filter(field => visible.has(field.name) || (field.defaultValue !== undefined && editable(object, access, field.name)));
    const values = yield* prepareValues(fields, given);
    const parts = Object.fromEntries(view.tableParts.filter(part => part.access !== 'deny').map(part => [part.name, []]));
    return { ...values, ...parts, ...given };
});

/** Подготавливает выбранные поля строки или окна действия, не выполняя само действие. */
export const prepareFieldDefaults = Effect.fnUntraced(function* (object: ObjectDescription, payload: RecordValue) {
    const access = yield* currentAccess;
    if (!access.user.allows(readRight(object))) return yield* accessDenied(access, object, 'read', 'read', 'deny');
    const actionName = payload['action'] === undefined ? undefined : stringValue(payload['action'], 'payload.action');
    const partName = payload['tablePart'] === undefined ? undefined : stringValue(payload['tablePart'], 'payload.tablePart');
    let fields: readonly FieldDescription[];
    if (actionName === undefined) {
        if (partName === undefined) return yield* new DataValidationError({ message: 'Нужно указать табличную часть или действие', fields: ['payload.tablePart', 'payload.action'] });
        yield* requireRecordWrite(object, access);
        const part = object.tableParts.find(part => part.name === partName);
        if (part === undefined) return yield* new DataNotFoundError({ message: `Табличная часть «${partName}» не найдена` });
        fields = part.fields.filter(field => editable(object, access, `${partName}.${field.name}`));
    } else {
        const action = object.actions.find(action => action.name === actionName);
        const right = requiredRight(object, actionName);
        if (action === undefined || right === undefined) return yield* new DataNotFoundError({ message: `Действие «${actionName}» не найдено` });
        if (!access.user.allows(right)) return yield* accessDenied(access, object, `actions.${actionName}`, 'allow', 'deny');
        const part = partName === undefined ? undefined : action.tableParts.find(part => part.name === partName);
        if (partName !== undefined && part === undefined) return yield* new DataNotFoundError({ message: `Табличная часть «${partName}» не найдена` });
        fields = part?.fields ?? action.input;
    }
    const names = payload['fields'];
    if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) {
        return yield* new DataValidationError({ message: 'Нужно указать имена полей', fields: ['payload.fields'] });
    }
    const requested = new Set(names);
    return yield* prepareValues(fields.filter(field => requested.has(field.name) && !field.managed && field.computed == null));
});
