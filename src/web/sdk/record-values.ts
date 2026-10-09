/**
 * Значения формы записи: начальные значения, значения по записи и входные данные действия `save`.
 *
 * Форма хранит значения в формате сервера, поэтому здесь нет перевода значений, только выбор
 * нужных полей. На форме есть не все поля записи: поля только для чтения заполняет платформа,
 * а скрытые переопределением формы в описание не попадают.
 */
import type { FormField, FormTablePart, FormView } from '../../server/ui/descriptions';
import type { RecordData } from '../data-provider/records';

/** Значения формы: значения редактируемых полей по именам и строки табличных частей по именам частей. */
export type FormValues = { readonly [name: string]: unknown };

/**
 * Значение поля в новой записи или в новой строке. Обязательный флажок сразу снят, а обязательные
 * дата и время равны текущему моменту: так заполняется дата нового документа. Остальные поля пусты.
 */
function initialValue(field: FormField): unknown {
    if (!field.rules.required) return null;
    if (field.kind === 'boolean') return false;
    if (field.kind === 'dateTime') return new Date().toISOString();
    return null;
}

function initialValues(fields: ReadonlyArray<FormField>): { [name: string]: unknown } {
    return Object.fromEntries(fields.map((field) => [field.name, initialValue(field)]));
}

/** Поля шапки, которые пользователь заполняет. Поля только для чтения в значения формы не входят. */
function editableFields(form: FormView): ReadonlyArray<FormField> {
    return form.fields.filter((field) => !field.readOnly);
}

/** Значения формы новой записи: редактируемые поля шапки и пустые табличные части. */
export function newRecordValues(form: FormView): FormValues {
    return { ...initialValues(editableFields(form)), ...Object.fromEntries(form.tableParts.map((part) => [part.name, []])) };
}

/**
 * Начальные значения окна входных данных действия. Они заполняются так же, как поля новой записи:
 * обязательные дата и время равны текущему моменту, например дата закрытия смены.
 */
export function newInputValues(fields: ReadonlyArray<FormField>): FormValues {
    return initialValues(fields);
}

/** Значения новой строки табличной части. */
export function newRowValues(part: FormTablePart): FormValues {
    return initialValues(part.columns);
}

/** Строка табличной части, в которой оставлены только колонки из описания. */
function rowValues(part: FormTablePart, row: unknown): FormValues {
    const values = (typeof row === 'object' && row !== null ? row : {}) as RecordData;
    return Object.fromEntries(part.columns.map((column) => [column.name, values[column.name] ?? null]));
}

/** Значения формы по записи с сервера либо по значениям, которые отдала форма Ant Design. */
export function recordValues(form: FormView, record: RecordData): FormValues {
    return {
        ...Object.fromEntries(editableFields(form).map((field) => [field.name, record[field.name] ?? null])),
        ...Object.fromEntries(
            form.tableParts.map((part) => {
                const rows = record[part.name];
                return [part.name, Array.isArray(rows) ? rows.map((row) => rowValues(part, row)) : []];
            }),
        ),
    };
}

/**
 * Входные данные `fields` действия `save`. Действие заменяет запись целиком: поле, которое
 * не передано, сервер запишет как `null`. Если отправить только значения формы, запись
 * существующей записи обнулила бы поля, скрытые переопределением формы. Поэтому отправляется
 * загруженная запись, в которой значения полей формы заменены введёнными. Поля, которые
 * заполняет платформа (`guid`, `deletedAt`, `number`, `posted`), сервер во входных данных пропускает.
 */
export function saveFields(form: FormView, saved: RecordData | null, entered: FormValues): FormValues {
    return { ...saved, ...recordValues(form, entered) };
}
