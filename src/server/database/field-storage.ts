/**
 * Отображение логического поля на столбцы: схема, запросы и восстановление строк используют
 * один контракт. Составное поле раскрывается здесь, поэтому сервисы не знают его устройства.
 */
import { Schema } from 'effect';
import type { FieldDescription } from '../metadata/descriptions.js';
import { fieldSchema } from '../metadata/schema.js';
import type { SqlValue } from './sql.builder.js';

/** Физический столбец поля; обязательность участвует в построении начальной схемы. */
export interface StorageColumn {
    readonly name: string;
    readonly type: 'TEXT' | 'INTEGER' | 'REAL';
    readonly required: boolean;
}

/** Кодек поля проверяет логическое значение, раскладывает его и собирает из строки БД. */
export interface FieldStorage {
    readonly columns: readonly StorageColumn[];
    readonly encode: (value: unknown, allowNull?: boolean) => readonly SqlValue[];
    readonly decode: (row: Readonly<Record<string, unknown>>) => unknown;
}

/** Ключи строк табличной части входят в схему и запросы с одинаковыми типами и обязательностью. */
export const tablePartStorageFields: readonly FieldDescription[] = (() => {
    const base = { role: 'attribute', managed: true, required: true, title: '', minimumLength: null,
        maximumLength: null, minimum: null, maximum: null, integer: false, target: null, choices: null } as const;
    return [{ ...base, name: 'ownerGuid', kind: 'guid' },
        { ...base, name: 'lineNumber', kind: 'number', integer: true, minimum: 1 }];
})();

/**
 * Возвращает отображение поля. `allowNull` разрешает искать NULL даже в обязательном поле:
 * добавленная при синхронизации колонка может содержать NULL у старых строк.
 */
export function fieldStorage(field: FieldDescription): FieldStorage {
    const composite = field.kind === 'recorder';
    const type = field.kind === 'number' ? (field.integer ? 'INTEGER' : 'REAL')
        : field.kind === 'money' || field.kind === 'boolean' ? 'INTEGER' : 'TEXT';
    const columns: readonly StorageColumn[] = composite
        ? [{ name: 'recorderDocument', type: 'TEXT', required: field.required }, { name: 'recorderGuid', type: 'TEXT', required: field.required }]
        : [{ name: field.name, type, required: field.required }];
    // Поля метаданных проверяются синхронно и не требуют сервисов Effect.
    const validate = Schema.decodeUnknownSync(fieldSchema(field) as unknown as Schema.ConstraintDecoder<unknown>);
    return {
        columns,
        encode: (value, allowNull = false) => {
            if (value === null) {
                if (!allowNull && field.required) throw new Error(`Поле «${field.name}» обязательно`);
                return columns.map(() => null);
            }
            if (value === undefined) throw new Error(`Не задано значение поля «${field.name}»`);
            validate(value);
            if (composite) {
                const recorder = value as { readonly document: string; readonly guid: string };
                if (!/^[a-z][a-zA-Z0-9]{0,59}$/.test(recorder.document)) throw new Error('Недопустимое имя документа-регистратора');
                return [recorder.document, recorder.guid];
            }
            if (field.kind === 'boolean') return [value === true ? 1 : 0];
            if (field.kind === 'objectReference') {
                const reference = value as { readonly kind: string; readonly name: string; readonly guid: string };
                return [JSON.stringify({ kind: reference.kind, name: reference.name, guid: reference.guid })];
            }
            return [value as string | number];
        },
        decode: (row) => {
            if (composite) {
                const document = row[columns[0]!.name];
                const guid = row[columns[1]!.name];
                return document === null && guid === null ? null : { document, guid };
            }
            const value = row[field.name];
            if (value === null || value === undefined) return value;
            if (field.kind === 'boolean') return value === 1;
            if (field.kind === 'objectReference') return JSON.parse(value as string);
            return value;
        },
    };
}
