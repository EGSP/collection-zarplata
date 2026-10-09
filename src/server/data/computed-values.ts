import { Effect } from 'effect';
import { computeFields } from '../../common/formulas.js';
import type { FieldDescription, TablePartDescription } from '../metadata/descriptions.js';
import { DataValidationError } from './data.errors.js';
import { objectValue, type RecordValue } from './records.js';

/**
 * Заменяет клиентские вычисляемые значения до проверки схемы и политик.
 * Сначала рассчитываются строки, затем шапка; ошибки содержат путь конкретной ячейки.
 */
export function calculatedInput(fields: ReadonlyArray<FieldDescription>, parts: ReadonlyArray<TablePartDescription>, input: unknown, location: string): Effect.Effect<RecordValue, DataValidationError> {
    return Effect.try({
        try: () => {
            const values = { ...objectValue(input, location) };
            const compute = (fields: ReadonlyArray<FieldDescription>, record: RecordValue, path: string): RecordValue => {
                try { return computeFields(fields, record); }
                catch (cause) { throw new DataValidationError({ message: String(cause), fields: fields.filter((field) => field.computed).map((field) => `${path}.${field.name}`) }); }
            };
            for (const part of parts) {
                const rows = values[part.name];
                if (Array.isArray(rows)) values[part.name] = rows.map((row, index) => compute(part.fields, objectValue(row, `${location}.${part.name}.${index}`), `${location}.${part.name}.${index}`));
            }
            return compute(fields, values, location);
        },
        catch: (cause) => cause instanceof DataValidationError ? cause : new DataValidationError({ message: String(cause), fields: [location] }),
    });
}
