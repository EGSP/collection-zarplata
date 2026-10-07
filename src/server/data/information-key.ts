/** Проверка составного ключа сведений, общая для действий и чтения журнала. */
import { Effect } from 'effect';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { fieldsSchema } from '../metadata/schema.js';
import { DataValidationError } from './data.errors.js';
import { objectValue, validated, type RecordValue } from './records.js';

/**
 * Проверяет полный ключ и возвращает измерения в порядке метаданных.
 * Пропуски, null, неверные типы и посторонние поля завершаются ошибкой 400.
 */
export const informationKey = Effect.fnUntraced(function* (description: ObjectDescription, value: unknown, location: string = 'payload.dimensions') {
    const dimensions = description.fields.filter((field) => field.role === 'dimension');
    const input = objectValue(value, location);
    for (const name of Object.keys(input)) {
        if (!dimensions.some((field) => field.name === name)) {
            return yield* new DataValidationError({ message: `Неизвестное измерение «${name}»`, fields: [`${location}.${name}`] });
        }
    }
    const checked = yield* validated(fieldsSchema(dimensions), input, location);
    return Object.fromEntries(dimensions.map((field) => [field.name, checked[field.name]])) as RecordValue;
});
