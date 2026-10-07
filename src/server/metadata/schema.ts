/**
 * Effect Schema для проверки входных данных, построенная из описания полей.
 *
 * Схема только проверяет значения и не переводит строки в даты: даты хранятся в базе строками
 * ISO 8601, и перевод туда и обратно ничего бы не дал. Сообщения об ошибках на русском, потому
 * что они доходят до пользователя; сообщения Effect по умолчанию английские.
 */
import { Schema } from 'effect';
import type { FieldDescription, FieldKind, ObjectDescription } from './descriptions.js';

const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Часовой пояс обязателен: время без пояса разные машины прочитают по-разному. */
const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
/** Любая версия UUID: платформа создаёт UUIDv7, но ссылку могут передать и на объект, пришедший из другой программы. */
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Проверяет, что дата существует в календаре. Шаблон пропускает `2026-02-30`, а `Date` молча
 * переносит такую дату на 2 марта, поэтому после создания даты её части сравниваются с исходными.
 */
function isCalendarDate(year: string, month: string, day: string): boolean {
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day);
}

/** Ожидаемое значение по виду поля: для сообщения о неверном типе. */
const expectedValues: { readonly [Kind in FieldKind]: string } = {
    string: 'строка',
    number: 'число',
    money: 'сумма в копейках',
    date: 'дата',
    dateTime: 'дата и время',
    boolean: 'логическое значение',
    reference: 'guid объекта',
    guid: 'guid',
    recorder: 'регистратор { document, guid }',
};

/**
 * Базовый тип поля с сообщением о неверном типе значения. Проверки добавляются после него:
 * аннотация, поставленная после проверки, относится к проверке, а не к типу.
 */
function typed<S extends Schema.Top>(schema: S, kind: FieldKind): S['Rebuild'] {
    return schema.annotate({ message: `ожидается ${expectedValues[kind]}` });
}

const DateString = typed(Schema.String, 'date').check(
    Schema.makeFilter((value: string) => {
        const match = datePattern.exec(value);
        return (match !== null && isCalendarDate(match[1]!, match[2]!, match[3]!)) || 'ожидается дата в формате YYYY-MM-DD';
    }),
);

const DateTimeString = typed(Schema.String, 'dateTime').check(
    Schema.makeFilter((value: string) => {
        const match = dateTimePattern.exec(value);
        return (
            (match !== null && isCalendarDate(match[1]!, match[2]!, match[3]!) && !Number.isNaN(Date.parse(value))) ||
            'ожидаются дата и время ISO 8601 с часовым поясом, например 2026-09-29T10:00:00+03:00'
        );
    }),
);

function guidString(kind: 'guid' | 'reference'): Schema.Top {
    return typed(Schema.String, kind).check(Schema.makeFilter((value: string) => uuidPattern.test(value) || 'ожидается guid'));
}

const RecorderValue = typed(Schema.Struct({ document: Schema.String, guid: guidString('guid') }), 'recorder');

function numberSchema(field: FieldDescription): Schema.Top {
    const { minimum, maximum } = field;
    // Здесь не используется typed(): диагностика Effect требует, чтобы проверка конечности
    // стояла в одной цепочке с Schema.Number, иначе считает, что NaN и Infinity допустимы.
    return Schema.Number.annotate({ message: `ожидается ${expectedValues[field.kind]}` }).check(
        Schema.isFinite({ message: 'ожидается конечное число' }),
        ...(field.integer ? [Schema.makeFilter((value: number) => Number.isSafeInteger(value) || 'ожидается целое число')] : []),
        ...(minimum === null ? [] : [Schema.makeFilter((value: number) => value >= minimum || `значение меньше ${minimum}`)]),
        ...(maximum === null ? [] : [Schema.makeFilter((value: number) => value <= maximum || `значение больше ${maximum}`)]),
    );
}

function stringSchema(field: FieldDescription): Schema.Top {
    const { minimumLength, maximumLength, choices } = field;
    const checks = [
        ...(choices === null ? [] : [Schema.makeFilter((value: string) => choices.includes(value) || `Ожидается одно из значений: ${choices.join(', ')}`)]),
        // Строка из пробелов в форме выглядит пустой, поэтому обязательное поле она не заполняет.
        ...(field.required ? [Schema.makeFilter((value: string) => value.trim() !== '' || 'значение не заполнено')] : []),
        ...(minimumLength === null ? [] : [Schema.makeFilter((value: string) => value.length >= minimumLength || `длина меньше ${minimumLength}`)]),
        ...(maximumLength === null ? [] : [Schema.makeFilter((value: string) => value.length <= maximumLength || `длина больше ${maximumLength}`)]),
    ];
    const [first, ...rest] = checks;
    const base = typed(Schema.String, 'string');
    return first === undefined ? base : base.check(first, ...rest);
}

/** Схема значения одного поля без учёта обязательности. */
export function fieldSchema(field: FieldDescription): Schema.Top {
    switch (field.kind) {
        case 'string':
            return stringSchema(field);
        case 'number':
        case 'money':
            return numberSchema(field);
        case 'date':
            return DateString;
        case 'dateTime':
            return DateTimeString;
        case 'boolean':
            return typed(Schema.Boolean, 'boolean');
        case 'reference':
        case 'guid':
            return guidString(field.kind);
        case 'recorder':
            return RecorderValue;
    }
}

/**
 * Схема записи по набору полей: обязательное поле должно быть передано,
 * необязательное можно пропустить или передать `null`.
 */
export function fieldsSchema(fields: ReadonlyArray<FieldDescription>): Schema.Struct<Schema.Struct.Fields> {
    const entries = fields.map((field) => {
        const expected = expectedValues[field.kind];
        const schema = fieldSchema(field);
        return [
            field.name,
            field.required
                ? schema.annotateKey({ messageMissingKey: 'значение не заполнено' })
                : Schema.optionalKey(Schema.NullOr(schema).annotate({ message: `ожидается ${expected} или null` })),
        ] as const;
    });
    return Schema.Struct(Object.fromEntries(entries));
}

/**
 * Схема входных данных записи объекта: поля, которые заполняет пользователь
 * (без полей, которые заполняет платформа), и табличные части.
 */
export function inputSchema(description: ObjectDescription): Schema.Struct<Schema.Struct.Fields> {
    const fields = description.fields.filter((field) => !field.managed);
    const tableParts = description.tableParts.map(
        (part) =>
            [
                part.name,
                Schema.Array(fieldsSchema(part.fields))
                    .annotate({ message: 'ожидается список строк табличной части' })
                    .annotateKey({ messageMissingKey: 'табличная часть не передана' }),
            ] as const,
    );
    return Schema.Struct({ ...fieldsSchema(fields).fields, ...Object.fromEntries(tableParts) });
}

/** Схема входных данных собственного действия. */
export function actionInputSchema(description: ObjectDescription, action: string): Schema.Struct<Schema.Struct.Fields> | null {
    const found = description.actions.find((candidate) => candidate.name === action);
    return found === undefined ? null : fieldsSchema(found.input);
}
