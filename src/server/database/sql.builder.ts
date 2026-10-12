/**
 * Билдер запросов платформы: метаданные задают имена и типы логических полей, отображение
 * хранения задаёт столбцы, а этот модуль формирует SQL и параметры для Database.
 * Функции с именем таблицы обслуживают служебные таблицы, не описанные объектами конфигурации.
 */
import type { FieldEntry, ListRecordOf, ObjectBuilder } from '../metadata/builders.js';
import type { AnyFieldBuilder, FieldsRecord } from '../metadata/fields.js';
import type { FieldDescription, ObjectDescription } from '../metadata/descriptions.js';
import { fieldStorage, tablePartStorageFields, type FieldStorage } from './field-storage.js';
import type { TypedSqlQuery } from './typed-query.js';

/** Значение запроса передаётся драйверу отдельно от текста SQL. */
export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

/** Готовый запрос: `sql` содержит только SQL и маркеры `?`, значения лежат в `parameters`. */
export interface SqlQuery {
    readonly sql: string;
    readonly parameters: readonly SqlValue[];
}

/** Одно условие отбора. Несколько условий объединяются через `AND`. */
export interface SqlCondition {
    readonly column: string;
    readonly operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE';
    readonly value: SqlValue;
}

/**
 * Условия, из которых достаточно выполнения одного: в SQL они соединяются через `OR`
 * и заключаются в скобки, поэтому группа объединяется с остальными условиями через `AND`.
 * Пустая группа отклоняется: в SQL у неё нет однозначного смысла.
 */
export interface SqlAnyCondition {
    readonly any: readonly SqlCondition[];
}

/** Элемент отбора: отдельное условие или группа условий через `OR`. */
export type SqlFilter = SqlCondition | SqlAnyCondition;

/** Колонка и направление сортировки; направление ограничено двумя ключевыми словами SQL. */
export interface SqlOrder {
    readonly column: string;
    readonly direction: 'ASC' | 'DESC';
}

/** Настройки выборки. Без `columns` выбираются все колонки, без `limit` — все строки. */
export interface SelectOptions {
    readonly columns?: readonly string[];
    readonly where?: readonly SqlFilter[];
    readonly orderBy?: readonly SqlOrder[];
    readonly limit?: number;
    readonly offset?: number;
}

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const operators = new Set<SqlCondition['operator']>(['=', '!=', '<', '<=', '>', '>=', 'LIKE']);

/**
 * Проверяет и экранирует имя таблицы или колонки.
 * Имена нельзя передать параметрами драйвера, поэтому перед включением в SQL их нужно
 * ограничить допустимыми символами; кавычки защищают совпадения с ключевыми словами.
 */
export function sqlIdentifier(identifier: string): string {
    if (!identifierPattern.test(identifier)) {
        throw new Error(`Недопустимое имя таблицы или колонки: «${identifier}»`);
    }
    return `"${identifier}"`;
}

/** Строит одно условие и добавляет его значение в `parameters`. */
function condition(value: SqlCondition, parameters: SqlValue[]): string {
    const column = sqlIdentifier(value.column);
    if (!operators.has(value.operator)) throw new Error('Недопустимый оператор отбора');
    if (value.value === null) {
        // Сравнение `= NULL` в SQL не даёт совпадения; для него нужны IS NULL / IS NOT NULL.
        if (value.operator === '=') return `${column} IS NULL`;
        if (value.operator === '!=') return `${column} IS NOT NULL`;
        throw new Error('С NULL допустимы только операторы = и !=');
    }
    parameters.push(value.value);
    return `${column} ${value.operator} ?`;
}

/** Добавляет значения отбора в том же порядке, в каком в SQL появляются маркеры `?`. */
function conditions(where: readonly SqlFilter[] | undefined, parameters: SqlValue[]): string {
    if (where === undefined || where.length === 0) return '';
    return ` WHERE ${where.map((filter) => {
        if (!('any' in filter)) return condition(filter, parameters);
        // Пустая группа в скобках была бы синтаксической ошибкой, а её замена на FALSE или TRUE
        // скрыла бы ошибку вызывающего кода, которая в UPDATE и DELETE затронула бы всю таблицу.
        if (filter.any.length === 0) throw new Error('Группа условий OR не может быть пустой');
        // Скобки сохраняют смысл группы: без них AND связал бы соседние условия сильнее OR.
        return `(${filter.any.map((member) => condition(member, parameters)).join(' OR ')})`;
    }).join(' AND ')}`;
}

/** Ограничивает параметры страницы целыми числами, которые JavaScript представляет точно. */
function nonnegativeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} должно быть неотрицательным целым числом`);
    return value;
}

/** Строит выборку с отбором, сортировкой и страницей без вставки значений в текст SQL. */
export function select(table: string, options: SelectOptions = {}): SqlQuery {
    const parameters: SqlValue[] = [];
    const columns = options.columns === undefined ? '*' : options.columns.map(sqlIdentifier).join(', ');
    if (columns.length === 0) throw new Error('Нужно указать хотя бы одну колонку');
    let sql = `SELECT ${columns} FROM ${sqlIdentifier(table)}${conditions(options.where, parameters)}`;
    if (options.orderBy?.length) {
        sql += ` ORDER BY ${options.orderBy.map(({ column, direction }) => {
            if (direction !== 'ASC' && direction !== 'DESC') throw new Error('Недопустимое направление сортировки');
            return `${sqlIdentifier(column)} ${direction}`;
        }).join(', ')}`;
    }
    if (options.limit !== undefined) {
        sql += ' LIMIT ?';
        parameters.push(nonnegativeInteger(options.limit, 'Размер страницы'));
    } else if (options.offset !== undefined) {
        // SQLite требует LIMIT перед OFFSET; -1 означает отсутствие ограничения числа строк.
        sql += ' LIMIT ?';
        parameters.push(-1);
    }
    if (options.offset !== undefined) {
        sql += ' OFFSET ?';
        parameters.push(nonnegativeInteger(options.offset, 'Смещение страницы'));
    }
    return { sql, parameters };
}

/** Строит вставку; порядок значений совпадает с порядком колонок в SQL. */
export function insert(table: string, values: Readonly<Record<string, SqlValue>>): SqlQuery {
    const entries = Object.entries(values);
    if (entries.length === 0) throw new Error('Для INSERT нужно указать хотя бы одну колонку');
    const columns = entries.map(([column]) => sqlIdentifier(column)).join(', ');
    return {
        sql: `INSERT INTO ${sqlIdentifier(table)} (${columns}) VALUES (${entries.map(() => '?').join(', ')})`,
        parameters: entries.map(([, value]) => value),
    };
}

/** Обновляет только строки, выбранные условиями `where`. */
export function update(
    table: string,
    values: Readonly<Record<string, SqlValue>>,
    where: readonly SqlFilter[],
): SqlQuery {
    const entries = Object.entries(values);
    if (entries.length === 0) throw new Error('Для UPDATE нужно указать хотя бы одну колонку');
    // Пустой отбор мог бы изменить всю таблицу из-за ошибки вызывающего кода.
    if (where.length === 0) throw new Error('Для UPDATE нужно указать условия отбора');
    const parameters = entries.map(([, value]) => value);
    const assignments = entries.map(([column]) => `${sqlIdentifier(column)} = ?`).join(', ');
    return { sql: `UPDATE ${sqlIdentifier(table)} SET ${assignments}${conditions(where, parameters)}`, parameters };
}

/** Строит DELETE с обязательным отбором: случайный вызов не удалит всю таблицу. */
export function remove(table: string, where: readonly SqlFilter[]): SqlQuery {
    if (where.length === 0) throw new Error('Для DELETE нужно указать условия отбора');
    const parameters: SqlValue[] = [];
    return { sql: `DELETE FROM ${sqlIdentifier(table)}${conditions(where, parameters)}`, parameters };
}

/**
 * Операторы для значения поля. Значение из нескольких частей и логическое значение сравниваются
 * только на равенство. Составное поле отличает свойство `type`: оно упорядочено внутри простого
 * типа значения, а ссылочный и логический варианты билдер отклоняет при построении запроса.
 */
type FieldOperator<Value> = unknown extends Value ? SqlCondition['operator']
    : Exclude<Value, null> extends { readonly type: string } ? Exclude<SqlCondition['operator'], 'LIKE'>
    : Exclude<Value, null> extends boolean | object ? '=' | '!='
    : Exclude<Value, null> extends string ? SqlCondition['operator'] : Exclude<SqlCondition['operator'], 'LIKE'>;

/** Условие связывает имя поля, способ сравнения и тип значения; IN принимает значения того же поля. */
export type QueryCondition<Row extends Record<string, unknown>> = {
    [Name in keyof Row & string]:
        | { readonly column: Name; readonly operator: FieldOperator<Row[Name]>; readonly value: Row[Name] | null }
        | { readonly column: Name; readonly operator: 'IN'; readonly value: readonly Row[Name][] }
}[keyof Row & string];

/** Вложенные группы all/any соединяются через AND/OR; верхний список означает AND. */
export type QueryFilter<Row extends Record<string, unknown> = Record<string, unknown>> = QueryCondition<Row>
    | { readonly any: readonly QueryFilter<Row>[] }
    | { readonly all: readonly QueryFilter<Row>[] };

/** Настройки чтения в именах логических полей; без columns возвращаются все поля строки. */
export interface QuerySelectOptions<Row extends Record<string, unknown>, Columns extends readonly (keyof Row & string)[]> {
    readonly columns?: Columns;
    readonly where?: readonly QueryFilter<Row>[];
    readonly orderBy?: readonly { readonly column: keyof Row & string; readonly direction: 'ASC' | 'DESC' }[];
    readonly limit?: number;
    readonly offset?: number;
}

/** Имена числовых полей, допустимых в SUM. */
export type NumericQueryColumn<Row> = { [Name in keyof Row]: unknown extends Row[Name] ? Name : Exclude<Row[Name], null> extends number ? Name : never }[keyof Row] & string;

/** Вставка требует обязательные поля; поля с допустимым null можно пропустить. */
export type QueryInsertValues<Row> = Pick<Row, {
    [Name in keyof Row]: null extends Row[Name] ? never : Name
}[keyof Row]> & Partial<Row>;

/** Настройки группировки и сумм; отбор применяется до группировки, страница после неё. */
export interface QuerySumOptions<Row extends Record<string, unknown>, Groups extends readonly (keyof Row & string)[], Sums extends readonly NumericQueryColumn<Row>[]> {
    readonly groupBy: Groups;
    readonly sums: Sums;
    readonly where?: readonly QueryFilter<Row>[];
    readonly orderBy?: readonly { readonly column: Groups[number] | Sums[number]; readonly direction: 'ASC' | 'DESC' }[];
    readonly limit?: number;
    readonly offset?: number;
}

/** Типы строк табличных частей по исходному билдеру объекта. */
type QueryParts<Builder extends ObjectBuilder> = {
    [Name in keyof Builder['~tableParts']]: FieldsRecord<Builder['~tableParts'][Name]>
};

/** Поля строки части вместе с ключами, которые заполняет платформа. */
type TablePartRow<Row> = Row & { readonly ownerGuid: string; readonly lineNumber: number };

/** Описание варианта составного поля по его билдеру. */
function queryVariant(entry: FieldEntry, variant: AnyFieldBuilder): FieldDescription {
    const state = variant['~state'];
    // Цель входит в значение ссылочного варианта и в его столбец, поэтому здесь она нужна.
    // К построению запроса все файлы конфигурации загружены, и функция цели уже возвращает билдер.
    const target = typeof state.target === 'function' ? state.target() : state.target;
    return { ...state, name: entry.name, role: entry.role, managed: entry.managed, title: entry.name, required: true,
        target: target === null ? null : { kind: target.kind, name: target.name }, suggestions: null, variants: null, inputMode: 'solid' };
}

/** Описание поля билдера для кодека; цель обычной ссылки не требуется для проверки и хранения GUID. */
function queryField(entry: FieldEntry): FieldDescription {
    const state = entry.builder['~state'];
    return { ...state, name: entry.name, role: entry.role, managed: entry.managed,
        // Способ ввода запросу не нужен; значение задано, чтобы состояние билдера совпало с типом описания.
        title: state.title ?? entry.name, target: null, suggestions: null, inputMode: 'solid',
        variants: state.variants === null ? null : state.variants.map((variant) => queryVariant(entry, variant)) };
}

/** Неизвестная настройка не должна молча расширять выборку из-за опечатки в вызове JavaScript. */
function checkQueryProperties(value: unknown, allowed: readonly string[]): void {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидается объект настроек запроса');
    for (const name of Object.keys(value)) {
        if (!allowed.includes(name)) throw new Error(`Неизвестная настройка запроса «${name}»`);
    }
}

/**
 * Запросы одной таблицы в логических полях. Билдер не выполняет запрос и не открывает транзакцию:
 * права, политики и атомарность остаются у действующего контура действий.
 * Все методы отклоняют неверные имена, значения и варианты операторов до обращения к Database.
 */
export class PlatformQuery<Row extends Record<string, unknown>, Parts extends Record<string, Record<string, unknown>> = {}> {
    private readonly fields = new Map<string, { readonly description: FieldDescription; readonly storage: FieldStorage }>();

    constructor(
        private readonly table: string,
        descriptions: readonly FieldDescription[],
        private readonly parts: ReadonlyMap<string, readonly FieldDescription[]> = new Map(),
    ) {
        sqlIdentifier(table);
        const columns = new Set<string>();
        for (const description of descriptions) {
            if (this.fields.has(description.name)) throw new Error(`Повторяется поле «${description.name}»`);
            const storage = fieldStorage(description);
            for (const column of storage.columns) {
                sqlIdentifier(column.name);
                if (columns.has(column.name)) throw new Error(`Повторяется столбец «${column.name}»`);
                columns.add(column.name);
            }
            this.fields.set(description.name, { description, storage });
        }
    }

    /** Возвращает билдер строк объявленной табличной части с ownerGuid и lineNumber. */
    tablePart<Name extends keyof Parts & string>(name: Name): PlatformQuery<TablePartRow<Parts[Name]>> {
        const fields = this.parts.get(name);
        if (fields === undefined) throw new Error(`Табличная часть «${name}» не найдена`);
        return new PlatformQuery(`${this.table}_${name}`, [...tablePartStorageFields, ...fields]);
    }

    private field(name: string) {
        const field = this.fields.get(name);
        if (field === undefined) throw new Error(`Поле «${name}» отсутствует в таблице «${this.table}»`);
        return field;
    }

    private columnNames(names: readonly string[]): string[] {
        if (!Array.isArray(names) || names.some((name) => typeof name !== 'string')) throw new Error('Поля должны быть списком имён');
        if (names.length === 0) throw new Error('Нужно указать хотя бы одно поле');
        if (new Set(names).size !== names.length) throw new Error('Поле указано дважды');
        return names.flatMap((name) => this.field(name).storage.columns.map((column) => sqlIdentifier(column.name)));
    }

    private filter(filter: QueryFilter<Row>, parameters: SqlValue[]): string {
        if (filter === null || typeof filter !== 'object' || Array.isArray(filter)) throw new Error('Ожидается условие отбора');
        if ('any' in filter || 'all' in filter) {
            checkQueryProperties(filter, ['any' in filter ? 'any' : 'all']);
            const group = 'any' in filter ? filter.any : filter.all;
            if (!Array.isArray(group) || group.length === 0) throw new Error('Группа условий не может быть пустой');
            return `(${group.map((member: QueryFilter<Row>) => this.filter(member, parameters)).join('any' in filter ? ' OR ' : ' AND ')})`;
        }
        checkQueryProperties(filter, ['column', 'operator', 'value']);
        const { description, storage } = this.field(filter.column);
        const compare = (value: unknown, operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE'): string => {
            if (!operators.has(operator)) throw new Error('Недопустимый оператор отбора');
            if (value === null) {
                if (operator !== '=' && operator !== '!=') throw new Error('С NULL допустимы только = и !=');
                const names = storage.columns.map((column) => sqlIdentifier(column.name));
                return `(${names.map((name) => `${name} IS ${operator === '=' ? '' : 'NOT '}NULL`).join(operator === '=' ? ' AND ' : ' OR ')})`;
            }
            if (operator === 'LIKE') {
                if (!['string', 'date', 'dateTime'].includes(description.kind) || typeof value !== 'string') throw new Error('LIKE требует строковое поле и строковый шаблон');
                parameters.push(value);
                return `(${sqlIdentifier(storage.columns[0]!.name)} LIKE ?)`;
            }
            const comparison = storage.comparison(value);
            const names = comparison.columns.map(sqlIdentifier);
            parameters.push(...comparison.values);
            if (operator === '=') return `(${names.map((name) => `${name} = ?`).join(' AND ')})`;
            // Неравенство значения из нескольких частей истинно, если отличается хотя бы одна его часть.
            if (operator === '!=') return `(${names.map((name) => `${name} != ?`).join(' OR ')})`;
            if (!comparison.ordered) throw new Error(`Для поля «${description.name}» и этого значения допустимы только =, != и IN`);
            // Порядок существует внутри одного типа значения: ведущие столбцы фиксируют тип, последний сравнивается.
            return `(${names.map((name, index) => `${name} ${index === names.length - 1 ? operator : '='} ?`).join(' AND ')})`;
        };
        if (filter.operator === 'IN') {
            if (!Array.isArray(filter.value) || filter.value.length === 0) throw new Error('IN требует непустой список значений');
            return `(${filter.value.map((value: unknown) => compare(value, '=')).join(' OR ')})`;
        }
        return compare(filter.value, filter.operator);
    }

    private where(filters: readonly QueryFilter<Row>[] | undefined, parameters: SqlValue[]): string {
        if (filters === undefined) return '';
        if (!Array.isArray(filters)) throw new Error('Отбор должен быть списком условий');
        return filters.length === 0 ? '' : ` WHERE ${filters.map((filter) => this.filter(filter, parameters)).join(' AND ')}`;
    }

    private tail(options: QuerySelectOptions<Row, readonly (keyof Row & string)[]>, parameters: SqlValue[]): string {
        let sql = '';
        if (options.orderBy !== undefined) {
            if (!Array.isArray(options.orderBy)) throw new Error('Сортировка должна быть списком');
            if (options.orderBy.length > 0) sql += ` ORDER BY ${options.orderBy.flatMap((order) => {
                checkQueryProperties(order, ['column', 'direction']);
                if (order.direction !== 'ASC' && order.direction !== 'DESC') throw new Error('Недопустимое направление сортировки');
                if (typeof order.column !== 'string') throw new Error('Сортировка требует имя поля');
                return this.field(order.column).storage.orderColumns.map((name) => `${sqlIdentifier(name)} ${order.direction}`);
            }).join(', ')}`;
        }
        if (options.limit !== undefined || options.offset !== undefined) {
            sql += ' LIMIT ?';
            parameters.push(options.limit === undefined ? -1 : nonnegativeInteger(options.limit, 'Размер страницы'));
        }
        if (options.offset !== undefined) {
            sql += ' OFFSET ?';
            parameters.push(nonnegativeInteger(options.offset, 'Смещение страницы'));
        }
        return sql;
    }

    private decoder<Selected extends Record<string, unknown>>(names: readonly string[]): (row: Record<string, unknown>) => Selected {
        return (row) => Object.fromEntries(names.map((name) => [name, this.field(name).storage.decode(row)])) as Selected;
    }

    /** Строит выборку; тип результата содержит ровно выбранные логические поля. */
    select<const Columns extends readonly (keyof Row & string)[] = readonly (keyof Row & string)[]>(
        options: QuerySelectOptions<Row, Columns> = {},
    ): TypedSqlQuery<Pick<Row, Columns[number]>> {
        checkQueryProperties(options, ['columns', 'where', 'orderBy', 'limit', 'offset']);
        const names = options.columns ?? [...this.fields.keys()];
        const columns = this.columnNames(names);
        const parameters: SqlValue[] = [];
        return { sql: `SELECT ${columns.join(', ')} FROM ${sqlIdentifier(this.table)}${this.where(options.where, parameters)}${this.tail(options, parameters)}`,
            parameters, decodeRow: this.decoder(names) };
    }

    /** Подсчитывает строки по тому же отбору, что select, без сортировки и страницы. */
    count(options: { readonly where?: readonly QueryFilter<Row>[] } = {}): TypedSqlQuery<{ total: number }> {
        checkQueryProperties(options, ['where']);
        const parameters: SqlValue[] = [];
        return { sql: `SELECT COUNT(*) AS total FROM ${sqlIdentifier(this.table)}${this.where(options.where, parameters)}`,
            parameters, decodeRow: (row) => ({ total: Number(row['total']) }) };
    }

    /** Суммирует числовые поля; без группировки пустой набор даёт одну строку с нулями. */
    sums<const Groups extends readonly (keyof Row & string)[], const Sums extends readonly NumericQueryColumn<Row>[]>(
        options: QuerySumOptions<Row, Groups, Sums>,
    ): TypedSqlQuery<Pick<Row, Groups[number]> & { [Name in Sums[number]]: number }> {
        checkQueryProperties(options, ['groupBy', 'sums', 'where', 'orderBy', 'limit', 'offset']);
        if (!Array.isArray(options.groupBy) || !Array.isArray(options.sums)) throw new Error('Группировка и суммы должны быть списками полей');
        const groups = options.groupBy.length === 0 ? [] : this.columnNames(options.groupBy);
        if (options.sums.length === 0) throw new Error('Нужно указать хотя бы одно суммируемое поле');
        if (new Set(options.sums).size !== options.sums.length || options.sums.some((name) => options.groupBy.includes(name))) throw new Error('Поля группировки и сумм не должны повторяться');
        const sums = options.sums.map((name) => {
            const field = this.field(name);
            if (field.description.kind !== 'number' && field.description.kind !== 'money') throw new Error(`Поле «${name}» не является числовым`);
            return `COALESCE(SUM(${this.columnNames([name])[0]}), 0) AS ${sqlIdentifier(name)}`;
        });
        for (const order of options.orderBy ?? []) {
            if (![...options.groupBy, ...options.sums].includes(order.column)) throw new Error('Сортировка итога требует поле группировки или суммы');
        }
        const parameters: SqlValue[] = [];
        const decodeGroups = this.decoder<Pick<Row, Groups[number]>>(options.groupBy);
        return { sql: `SELECT ${[...groups, ...sums].join(', ')} FROM ${sqlIdentifier(this.table)}${this.where(options.where, parameters)}`
            + (groups.length === 0 ? '' : ` GROUP BY ${groups.join(', ')}`)
            + this.tail({ ...options, orderBy: options.orderBy ?? options.groupBy.map((column) => ({ column, direction: 'ASC' as const })) }, parameters),
            parameters, decodeRow: (row) => ({ ...decodeGroups(row), ...Object.fromEntries(options.sums.map((name) => [name, Number(row[name])])) }) as Pick<Row, Groups[number]> & { [Name in Sums[number]]: number } };
    }

    /** Наибольший номер документа как число; CAST сохраняет порядок после переполнения ширины номера. */
    maximumNumber(column: keyof Row & string): TypedSqlQuery<{ maximum: number | null }> {
        const field = this.field(column);
        if (!['string', 'number', 'money'].includes(field.description.kind)) throw new Error('Числовой максимум требует строку или число');
        return { sql: `SELECT MAX(CAST(${this.columnNames([column])[0]} AS INTEGER)) AS maximum FROM ${sqlIdentifier(this.table)}`,
            parameters: [], decodeRow: (row) => ({ maximum: row['maximum'] === null ? null : Number(row['maximum']) }) };
    }

    private values(values: Partial<Row>, creating: boolean): Record<string, SqlValue> {
        if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new Error('Значения записи должны быть объектом');
        for (const name of Object.keys(values)) this.field(name);
        const entries = creating ? [...this.fields.keys()].map((name) => [name, Object.hasOwn(values, name) ? values[name] : null] as const) : Object.entries(values);
        return Object.fromEntries(entries.flatMap(([name, value]) => {
            const storage = this.field(name).storage;
            const encoded = storage.encode(value);
            return storage.columns.map((column, index) => [column.name, encoded[index]!]);
        }));
    }

    /** Вставляет полную строку; отсутствующие необязательные поля записываются как NULL. */
    insert(values: QueryInsertValues<Row>): SqlQuery { return insert(this.table, this.values(values, true)); }

    /** Обновляет переданные поля; пустой отбор отклоняется, чтобы ошибка не изменила всю таблицу. */
    update(values: Partial<Row>, where: readonly QueryFilter<Row>[]): SqlQuery {
        if (!Array.isArray(where) || where.length === 0) throw new Error('Для UPDATE нужно указать условия отбора');
        const entries = Object.entries(this.values(values, false));
        if (entries.length === 0) throw new Error('Для UPDATE нужно указать хотя бы одно поле');
        const parameters = entries.map(([, value]) => value);
        return { sql: `UPDATE ${sqlIdentifier(this.table)} SET ${entries.map(([name]) => `${sqlIdentifier(name)} = ?`).join(', ')}${this.where(where, parameters)}`, parameters };
    }

    /** Удаляет строки по обязательному отбору; политики и транзакцию обеспечивает вызывающее действие. */
    remove(where: readonly QueryFilter<Row>[]): SqlQuery {
        if (!Array.isArray(where) || where.length === 0) throw new Error('Для DELETE нужно указать условия отбора');
        const parameters: SqlValue[] = [];
        return { sql: `DELETE FROM ${sqlIdentifier(this.table)}${this.where(where, parameters)}`, parameters };
    }
}

/** Билдер конфигурации сохраняет связь имён и значений полей с типом результата. */
export function query<Builder extends ObjectBuilder>(source: Builder): PlatformQuery<ListRecordOf<Builder>, QueryParts<Builder>>;
/** Описание метаданных используется сервисами с динамическими объектами; проверки выполняются во время построения. */
export function query(source: ObjectDescription): PlatformQuery<Record<string, unknown>, Record<string, Record<string, unknown>>>;
export function query(source: ObjectBuilder | ObjectDescription): PlatformQuery<Record<string, unknown>, Record<string, Record<string, unknown>>> {
    const builder = 'withStandardFields' in source ? source.withStandardFields()['~state'] : undefined;
    const fields = builder === undefined ? (source as ObjectDescription).fields : builder.fields.map(queryField);
    const parts = builder === undefined ? (source as ObjectDescription).tableParts
        : builder.tableParts.map((part) => ({ ...part, fields: part.fields.map(queryField) }));
    return new PlatformQuery(`${source.kind}_${source.name}`, fields, new Map(parts.map((part) => [part.name, part.fields])));
}
