/**
 * Отображение логического поля на столбцы: схема, запросы и восстановление строк используют
 * один контракт. Поле из нескольких столбцов раскрывается здесь, поэтому сервисы не знают его устройства.
 *
 * Составное поле хранит тип варианта в столбце-дискриминаторе, значение простого варианта
 * в типизированном столбце по способу хранения, а ссылку в общих столбцах цели и GUID. Заполнен
 * только выбранный вариант. Значения не упакованы в JSON, поэтому числовые сравнения и суммы
 * выполняет SQL без преобразований, а строка «100» и число 100 остаются разными значениями.
 */
import { Schema } from 'effect';
import { isOrderedCompositeValue } from '../metadata/composite.js';
import type { CompositeValue, FieldDescription } from '../metadata/descriptions.js';
import { fieldSchema } from '../metadata/schema.js';
import type { SqlValue } from './sql.builder.js';

/** Физический столбец поля; обязательность участвует в построении начальной схемы. */
export interface StorageColumn {
    readonly name: string;
    readonly type: 'TEXT' | 'INTEGER' | 'REAL';
    readonly required: boolean;
}

/**
 * Сравнение с заполненным значением: столбцы, которых достаточно для сравнения, и их значения.
 * `ordered` разрешает `<`, `>` и подобные: тогда все столбцы, кроме последнего, сравниваются
 * на равенство, а последний указанным оператором.
 */
export interface StorageComparison {
    readonly columns: readonly string[];
    readonly values: readonly SqlValue[];
    readonly ordered: boolean;
}

/** Кодек поля проверяет логическое значение, раскладывает его и собирает из строки БД. */
export interface FieldStorage {
    readonly columns: readonly StorageColumn[];
    /**
     * Столбцы первичного ключа, когда поле входит в ключ таблицы. Отличаются от `columns` только
     * у составного измерения: остальные его столбцы допускают NULL и в ключ войти не могут.
     */
    readonly keyColumns: readonly string[];
    /** Столбцы сортировки по полю в порядке старшинства. */
    readonly orderColumns: readonly string[];
    readonly encode: (value: unknown, allowNull?: boolean) => readonly SqlValue[];
    readonly decode: (row: Readonly<Record<string, unknown>>) => unknown;
    readonly comparison: (value: unknown) => StorageComparison;
}

/** Ключи строк табличной части входят в схему и запросы с одинаковыми типами и обязательностью. */
export const tablePartStorageFields: readonly FieldDescription[] = (() => {
    const base = { role: 'attribute', managed: true, required: true, title: '', minimumLength: null,
        maximumLength: null, minimum: null, maximum: null, integer: false, target: null, choices: null } as const;
    return [{ ...base, name: 'ownerGuid', kind: 'guid' },
        { ...base, name: 'lineNumber', kind: 'number', integer: true, minimum: 1 }];
})();

/** Физический тип столбца для простого вида поля. */
function columnType(field: FieldDescription): StorageColumn['type'] {
    return field.kind === 'number' ? (field.integer ? 'INTEGER' : 'REAL')
        : field.kind === 'money' || field.kind === 'boolean' ? 'INTEGER' : 'TEXT';
}

/** Поля метаданных проверяются синхронно и не требуют сервисов Effect; результат содержит только свойства схемы. */
function validator(field: FieldDescription): (value: unknown) => unknown {
    return Schema.decodeUnknownSync(fieldSchema(field) as unknown as Schema.ConstraintDecoder<unknown>);
}

/** Суффиксы типизированных столбцов составного поля по физическому типу. */
const compositeValueColumns = { TEXT: 'text', INTEGER: 'integer', REAL: 'real' } as const;

/**
 * Отображение составного поля `<имя>` на столбцы:
 * - `<имя>_type` хранит тип варианта;
 * - `<имя>_integer`, `<имя>_real`, `<имя>_text` хранят значение простого варианта; создаются
 *   только столбцы тех способов хранения, которые нужны объявленным вариантам;
 * - `<имя>_target` и `<имя>_guid` хранят цель (`catalog/receivers`) и GUID ссылки;
 * - `<имя>_key` есть только у измерения и хранит значение одной строкой.
 * Имена полей не содержат `_`, поэтому столбцы не совпадают со столбцами других полей.
 */
function compositeStorage(field: FieldDescription): FieldStorage {
    const variants = field.variants ?? [];
    const scalar = variants.filter((variant) => variant.kind !== 'reference');
    const valueTypes = (['INTEGER', 'REAL', 'TEXT'] as const).filter((type) => scalar.some((variant) => columnType(variant) === type));
    const hasReference = variants.some((variant) => variant.kind === 'reference');
    const type = `${field.name}_type`;
    const target = `${field.name}_target`;
    const guid = `${field.name}_guid`;
    const valueColumn = (physical: StorageColumn['type']): string => `${field.name}_${compositeValueColumns[physical]}`;
    // Turso требует NOT NULL у столбцов первичного ключа, а типизированные столбцы пусты у чужих
    // вариантов. Поэтому в ключ сведений входит один заполненный столбец со значением целиком.
    const key = field.role === 'dimension' ? `${field.name}_key` : null;
    const columns: readonly StorageColumn[] = [
        { name: type, type: 'TEXT', required: field.required },
        ...valueTypes.map((physical) => ({ name: valueColumn(physical), type: physical, required: false })),
        ...(hasReference ? [{ name: target, type: 'TEXT', required: false }, { name: guid, type: 'TEXT', required: false }] as const : []),
        ...(key === null ? [] : [{ name: key, type: 'TEXT', required: field.required }] as const),
    ];
    const validate = validator(field);
    /** Заполненные столбцы значения; столбцы, которых здесь нет, равны NULL. */
    const filled = (value: unknown): Map<string, SqlValue> => {
        const composite = validate(value) as CompositeValue;
        if (composite.type === 'reference') {
            return new Map<string, SqlValue>([[type, composite.type], [target, `${composite.kind}/${composite.name}`], [guid, composite.guid]]);
        }
        const variant = scalar.find((candidate) => candidate.kind === composite.type)!;
        const stored = typeof composite.value === 'boolean' ? (composite.value ? 1 : 0) : composite.value;
        return new Map<string, SqlValue>([[type, composite.type], [valueColumn(columnType(variant)), stored]]);
    };
    return {
        columns,
        keyColumns: key === null ? columns.map((column) => column.name) : [key],
        // Тип идёт первым: значения одного типа стоят рядом, а порядок внутри типа задаёт его столбец.
        orderColumns: columns.filter((column) => column.name !== key).map((column) => column.name),
        encode: (value, allowNull = false) => {
            if (value === null) {
                if (!allowNull && field.required) throw new Error(`Поле «${field.name}» обязательно`);
                return columns.map(() => null);
            }
            if (value === undefined) throw new Error(`Не задано значение поля «${field.name}»`);
            const values = filled(value);
            // Разделитель не встречается в типе и цели, поэтому разные значения не дают одинаковый ключ.
            if (key !== null) values.set(key, [...values.values()].join(':'));
            return columns.map((column) => values.get(column.name) ?? null);
        },
        decode: (row) => {
            const stored = row[type];
            if (stored === null || stored === undefined) return stored;
            if (stored === 'reference') {
                const [kind, name] = String(row[target]).split('/');
                return { type: stored, kind, name, guid: row[guid] };
            }
            const variant = scalar.find((candidate) => candidate.kind === stored);
            // Вариант могли убрать из конфигурации: его столбец остался, а способ хранения уже неизвестен.
            if (variant === undefined) throw new Error(`Поле «${field.name}» содержит значение типа «${String(stored)}», которого нет среди вариантов`);
            const value = row[valueColumn(columnType(variant))];
            return { type: stored, value: stored === 'boolean' ? value === 1 : value };
        },
        comparison: (value) => {
            const values = filled(value);
            return { columns: [...values.keys()], values: [...values.values()], ordered: isOrderedCompositeValue(value as CompositeValue) };
        },
    };
}

/**
 * Возвращает отображение поля. `allowNull` разрешает искать NULL даже в обязательном поле:
 * добавленная при синхронизации колонка может содержать NULL у старых строк.
 */
export function fieldStorage(field: FieldDescription): FieldStorage {
    if (field.kind === 'composite') return compositeStorage(field);
    const recorder = field.kind === 'recorder';
    const columns: readonly StorageColumn[] = recorder
        ? [{ name: 'recorderDocument', type: 'TEXT', required: field.required }, { name: 'recorderGuid', type: 'TEXT', required: field.required }]
        : [{ name: field.name, type: columnType(field), required: field.required }];
    const names = columns.map((column) => column.name);
    const validate = validator(field);
    const encode = (value: unknown, allowNull = false): readonly SqlValue[] => {
        if (value === null) {
            if (!allowNull && field.required) throw new Error(`Поле «${field.name}» обязательно`);
            return columns.map(() => null);
        }
        if (value === undefined) throw new Error(`Не задано значение поля «${field.name}»`);
        validate(value);
        if (recorder) {
            const reference = value as { readonly document: string; readonly guid: string };
            if (!/^[a-z][a-zA-Z0-9]{0,59}$/.test(reference.document)) throw new Error('Недопустимое имя документа-регистратора');
            return [reference.document, reference.guid];
        }
        if (field.kind === 'boolean') return [value === true ? 1 : 0];
        if (field.kind === 'objectReference') {
            const reference = value as { readonly kind: string; readonly name: string; readonly guid: string };
            return [JSON.stringify({ kind: reference.kind, name: reference.name, guid: reference.guid })];
        }
        return [value as string | number];
    };
    return {
        columns,
        keyColumns: names,
        orderColumns: names,
        encode,
        decode: (row) => {
            if (recorder) {
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
        // У значения из двух столбцов, логического значения и JSON-ссылки нет порядка, понятного пользователю.
        comparison: (value) => ({ columns: names, values: encode(value, true), ordered: !recorder && field.kind !== 'boolean' && field.kind !== 'objectReference' }),
    };
}
