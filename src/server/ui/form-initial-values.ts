/** Единые начальные значения для клиентской формы и серверной подготовки записи. */
import type { FormField, FormView } from './descriptions.js';
import { standardFieldDefault } from '../metadata/field-defaults.js';

/** Значение из описания поля имеет приоритет над общим правилом его вида. */
function initialValue(field: FormField): unknown {
    return field.defaultValue === undefined ? standardFieldDefault(field.kind, field.rules.required) : field.defaultValue.value;
}

/** Собирает значения шапки либо полей новой строки. */
export function initialFieldValues(fields: readonly FormField[]): Record<string, unknown> {
    return Object.fromEntries(fields.map(field => [field.name, initialValue(field)]));
}

/** Отбирает поля формы, которые участвуют в начальном заполнении и записи. */
export function editableFormFields(form: FormView): readonly FormField[] {
    return form.fields.filter(field => !field.readOnly || field.computed != null);
}

/** Заполняет шапку и создаёт пустые доступные табличные части. */
export function newRecordValues(form: FormView): Record<string, unknown> {
    return {
        ...initialFieldValues(editableFormFields(form)),
        ...Object.fromEntries(form.tableParts.filter(part => part.access !== 'deny').map(part => [part.name, []])),
    };
}
