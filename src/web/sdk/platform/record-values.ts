/**
 * Значения формы записи: начальные значения, значения по записи и входные данные действия `save`.
 *
 * Форма хранит значения в формате сервера, поэтому здесь нет перевода значений, только выбор
 * нужных полей. На форме есть не все поля записи: поля только для чтения заполняет платформа,
 * а скрытые переопределением формы в описание не попадают.
 */
import type { FieldDefaultsSource, FormField, FormTablePart, FormView } from '../../../server/ui/descriptions';
import { editableFormFields, initialFieldValues } from '../../../server/ui/form-initial-values';
import type { RecordData } from '../../data-provider/records';
import { perform } from '../../data-provider/perform';

export { newRecordValues } from '../../../server/ui/form-initial-values';

/** Значения формы: значения редактируемых полей по именам и строки табличных частей по именам частей. */
export type FormValues = { readonly [name: string]: unknown };

/** Постоянные и стандартные значения окна действия, доступные из описания формы. */
export function newInputValues(fields: ReadonlyArray<FormField>): FormValues {
    return initialFieldValues(fields);
}

/** Постоянные и стандартные значения новой строки, доступные из описания. */
export function newRowValues(part: FormTablePart): FormValues {
    return initialFieldValues(part.columns);
}

/** Запрашивает только вычисляемые поля, которым при открытии не передали значения. */
export function requestFieldDefaults(fields: readonly FormField[], source: FieldDefaultsSource | undefined, given: FormValues | undefined): Promise<FormValues> | undefined {
    if (source === undefined) return undefined;
    const names = fields.filter(field => field.serverDefault && (given === undefined || !Object.hasOwn(given, field.name))).map(field => field.name);
    if (names.length === 0) return undefined;
    return perform<FormValues>({
        target: { kind: 'platform', name: 'records' },
        action: 'prepareFieldDefaults',
        payload: { ...source, fields: names },
    });
}

/** Подготавливает новую строку целиком; при постоянных значениях работает синхронно. */
export function prepareNewRowValues(part: FormTablePart, given: FormValues = {}): FormValues | Promise<FormValues> {
    const defaults = newRowValues(part);
    const pending = requestFieldDefaults(part.columns, part.defaultsSource, given);
    return pending === undefined ? { ...defaults, ...given } : pending.then(values => ({ ...defaults, ...values, ...given }));
}

/** Строка табличной части, в которой оставлены только колонки из описания. */
function rowValues(part: FormTablePart, row: unknown): FormValues {
    const values = (typeof row === 'object' && row !== null ? row : {}) as RecordData;
    return Object.fromEntries(part.columns.filter(column => column.access !== 'deny').map((column) => [column.name, values[column.name] ?? null]));
}

/** Значения формы по записи с сервера либо по значениям, которые отдала форма Ant Design. */
export function recordValues(form: FormView, record: RecordData): FormValues {
    return {
        ...Object.fromEntries(editableFormFields(form).map((field) => [field.name, record[field.name] ?? null])),
        ...Object.fromEntries(
            form.tableParts.filter(part => part.access !== 'deny').map((part) => {
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
 *
 * У новой записи основой служит ответ подготовки (`NewFormProperties.default`).
 * В него входят и значения скрытых полей, переданные при открытии.
 */
export function saveFields(form: FormView, saved: RecordData | FormValues | null, entered: FormValues): FormValues {
    return { ...saved, ...recordValues(form, entered) };
}
