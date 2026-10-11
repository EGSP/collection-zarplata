/**
 * Итоги регистра оборотов: суммы ресурсов по сочетаниям значений измерений.
 *
 * Итог не хранится, а считается запросом по движениям при каждом чтении. Отдельная таблица
 * итогов потребовала бы обновлять её при каждом изменении движений и пересчитывать при сбое,
 * а объёмы магазина позволяют суммировать строки напрямую. Остаток получается тем же способом:
 * документы записывают движения со знаком, и сумма по измерениям даёт текущее значение.
 *
 * Один расчёт `readTotals` обслуживает три входа: типизированный вызов `totals(...)` из кода
 * конфигурации, стандартное действие `totals` единого эндпоинта и проверку ограничений итога.
 * Поэтому правило, которое проверила платформа, и число, которое прочитал клиент, не расходятся.
 */
import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { selectSums, type SqlFilter } from '../database/sql.builder.js';
import type { RegisterBuilder, ResourceTotals } from '../metadata/builders.js';
import type { FieldDescription, ObjectDescription } from '../metadata/descriptions.js';
import type { FieldMap, FieldsRecord } from '../metadata/fields.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { fieldSchema } from '../metadata/schema.js';
import { filterOperators, type FilterOperator } from '../ui/descriptions.js';
import { DataValidationError } from './data.errors.js';
import { objectValue, sqlOperators, sqlValue, stringValue, tableName, validated, type RecordValue } from './records.js';
import { fieldValueFromRow } from './storage-values.js';

/** Число знаков после запятой, до которого округляется сумма дробного ресурса. */
const fractionDigits = 9;

/**
 * Убирает погрешность двоичного сложения дробных чисел: без округления сумма движений
 * `0,3 − 0,1 − 0,2` получается чуть меньше нуля и нарушила бы ограничение «не меньше нуля».
 * Деньги и целые числа хранятся целыми и в округлении не нуждаются.
 */
function roundedSum(field: FieldDescription, value: unknown): number {
    const sum = typeof value === 'number' ? value : Number(value ?? 0);
    if (field.integer) return sum;
    const scale = 10 ** fractionDigits;
    return Math.round(sum * scale) / scale;
}

/** Измерения регистра в порядке объявления. */
export function registerDimensions(register: ObjectDescription): ReadonlyArray<FieldDescription> {
    return register.fields.filter((field) => field.role === 'dimension');
}

/** Ресурсы регистра в порядке объявления. */
export function registerResources(register: ObjectDescription): ReadonlyArray<FieldDescription> {
    return register.fields.filter((field) => field.role === 'resource');
}

/**
 * Считает суммы всех ресурсов регистра по сочетаниям значений измерений `by`. Строка результата
 * содержит значения этих измерений в том же виде, что и запись регистра, и суммы под именами
 * ресурсов. Сочетание без движений в результат не попадает; без группировки возвращается ровно
 * одна строка, при отсутствии движений с нулевыми суммами.
 *
 * Имена `by` и колонки `where` вызывающий код берёт из описания регистра: функция их не проверяет.
 */
export function readTotals(
    register: ObjectDescription,
    by: ReadonlyArray<string>,
    where: ReadonlyArray<SqlFilter> = [],
): Effect.Effect<ReadonlyArray<RecordValue>, DatabaseError, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const resources = registerResources(register);
        const rows = yield* database.all<RecordValue>(selectSums(tableName(register), {
            groupBy: by,
            sums: resources.map((field) => field.name),
            where,
        }));
        return rows.map((row) => {
            const result: RecordValue = {};
            for (const name of by) {
                const field = register.fields.find((candidate) => candidate.name === name);
                result[name] = field === undefined ? row[name] : fieldValueFromRow(row[name], field.kind);
            }
            for (const field of resources) result[field.name] = roundedSum(field, row[field.name]);
            return result;
        });
    });
}

/** Границы периода движений: `from` включается в отбор, `before` в него не входит. */
export interface TotalsPeriod {
    readonly from?: string;
    readonly before?: string;
}

/** Отбор движений для расчёта итога из кода конфигурации. */
export interface TotalsOptions<Fields extends FieldMap, Dimensions extends string, By extends ReadonlyArray<Dimensions>> {
    /** Измерения, по сочетаниям значений которых группируются суммы. */
    readonly by: By;
    /** Значения измерений, которым должны быть равны движения; `null` отбирает незаполненное измерение. */
    readonly where?: { readonly [Dimension in Dimensions & keyof Fields]?: FieldsRecord<Fields>[Dimension] };
    readonly period?: TotalsPeriod;
}

/** Строка итога: значения измерений группировки и суммы всех ресурсов регистра. */
export type TotalsRow<Fields extends FieldMap, Dimensions extends string, By extends ReadonlyArray<Dimensions>> =
    { readonly [Dimension in By[number] & keyof Fields]: FieldsRecord<Fields>[Dimension] } & ResourceTotals<Fields, Dimensions>;

/**
 * Итог регистра для политики, собственного действия или обработчика проведения. Читает движения
 * в транзакции текущего действия, поэтому видит изменения, уже выполненные в этом запросе.
 * Имена измерений проверяет компилятор по билдеру регистра; при вызове с непроверенными именами
 * неизвестное измерение завершает действие дефектом, а не попадает в SQL.
 */
export function totals<Name extends string, Fields extends FieldMap, Dimensions extends string, const By extends ReadonlyArray<Dimensions>>(
    register: RegisterBuilder<Name, Fields, Dimensions>,
    options: TotalsOptions<Fields, Dimensions, By>,
): Effect.Effect<ReadonlyArray<TotalsRow<Fields, Dimensions, By>>, DatabaseError, Database | Metadata> {
    return Effect.gen(function* () {
        const metadata = yield* Metadata;
        const description = metadata.find('register', register.name);
        if (description === undefined) return yield* Effect.die(new Error(`Регистр «${register.name}» не найден в конфигурации`));
        const dimensions = new Set(registerDimensions(description).map((field) => field.name));
        const equalities = Object.entries(options.where ?? {}).filter(([, value]) => value !== undefined);
        for (const name of [...options.by, ...equalities.map(([name]) => name)]) {
            if (!dimensions.has(name)) return yield* Effect.die(new Error(`У регистра «${register.name}» нет измерения «${name}»`));
        }
        const where: SqlFilter[] = equalities.map(([column, value]) => ({ column, operator: '=', value: sqlValue(value) }));
        if (options.period?.from !== undefined) where.push({ column: 'period', operator: '>=', value: options.period.from });
        if (options.period?.before !== undefined) where.push({ column: 'period', operator: '<', value: options.period.before });
        const rows = yield* readTotals(description, options.by, where);
        // Состав строки совпадает с типом по построению: измерения взяты из `by`, ресурсы из описания регистра.
        return rows as unknown as ReadonlyArray<TotalsRow<Fields, Dimensions, By>>;
    });
}

/**
 * Стандартное действие `totals` регистра. `payload.by` перечисляет измерения группировки,
 * `payload.where` содержит условия в формате отбора списка по измерениям и стандартному полю
 * `period`. Оба свойства необязательны. Неизвестное или повторённое измерение, недопустимый
 * способ сравнения и значение неверного типа возвращают 400.
 */
export function totalsAction(register: ObjectDescription, payload: unknown): Effect.Effect<{ readonly items: ReadonlyArray<RecordValue> }, DataValidationError | DatabaseError, Database> {
    return Effect.gen(function* () {
        const options = objectValue(payload, 'payload');
        const dimensions = registerDimensions(register);
        const by = options['by'] ?? [];
        const conditions = options['where'] ?? [];
        if (!Array.isArray(by) || !Array.isArray(conditions)) {
            return yield* new DataValidationError({ message: 'Измерения и отбор должны быть списками', fields: ['payload.by', 'payload.where'] });
        }
        const names: string[] = [];
        for (const raw of by) {
            const name = stringValue(raw, 'payload.by');
            if (!dimensions.some((field) => field.name === name)) {
                return yield* new DataValidationError({ message: `Неизвестное измерение «${name}»`, fields: [`payload.by.${name}`] });
            }
            if (names.includes(name)) return yield* new DataValidationError({ message: `Измерение «${name}» указано дважды`, fields: [`payload.by.${name}`] });
            names.push(name);
        }
        const where: SqlFilter[] = [];
        for (const raw of conditions) {
            const condition = objectValue(raw, 'payload.where');
            const name = stringValue(condition['field'], 'payload.where.field');
            const location = `payload.where.${name}`;
            const field = name === 'period' ? register.fields.find((candidate) => candidate.name === name) : dimensions.find((candidate) => candidate.name === name);
            if (field === undefined) return yield* new DataValidationError({ message: `Отбор итогов возможен по измерению или периоду, получено «${name}»`, fields: [location] });
            const operator = condition['operator'] as FilterOperator;
            // Подстрока ищется в отображаемом тексте каждой строки, а итог считает SQL до чтения строк.
            if (operator === 'contains' || !filterOperators[field.kind].includes(operator)) {
                return yield* new DataValidationError({ message: `Недопустимый способ сравнения для «${name}»`, fields: [location] });
            }
            const value = condition['value'];
            if (value === undefined || (value === null && operator !== 'equals' && operator !== 'notEquals')) {
                return yield* new DataValidationError({ message: `Неверное значение отбора «${name}»`, fields: [location] });
            }
            if (value !== null) yield* validated(fieldSchema(field), value, location);
            where.push({ column: name, operator: sqlOperators[operator], value: sqlValue(value) });
        }
        return { items: yield* readTotals(register, names, where) };
    });
}
