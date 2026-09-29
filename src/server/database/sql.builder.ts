/** Значение запроса передаётся драйверу отдельно от текста SQL. */
export type SqlValue = string | number | bigint | boolean | null | Uint8Array;

export interface SqlQuery {
    readonly sql: string;
    readonly parameters: readonly SqlValue[];
}

export interface SqlCondition {
    readonly column: string;
    readonly operator: '=' | '!=' | '<' | '<=' | '>' | '>=' | 'LIKE';
    readonly value: SqlValue;
}

export interface SqlOrder {
    readonly column: string;
    readonly direction: 'ASC' | 'DESC';
}

export interface SelectOptions {
    readonly columns?: readonly string[];
    readonly where?: readonly SqlCondition[];
    readonly orderBy?: readonly SqlOrder[];
    readonly limit?: number;
    readonly offset?: number;
}

const identifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const operators = new Set<SqlCondition['operator']>(['=', '!=', '<', '<=', '>', '>=', 'LIKE']);

export function sqlIdentifier(identifier: string): string {
    if (!identifierPattern.test(identifier)) {
        throw new Error(`Недопустимое имя таблицы или колонки: «${identifier}»`);
    }
    return `"${identifier}"`;
}

function conditions(where: readonly SqlCondition[] | undefined, parameters: SqlValue[]): string {
    if (where === undefined || where.length === 0) return '';
    return ` WHERE ${where.map((condition) => {
        const column = sqlIdentifier(condition.column);
        if (!operators.has(condition.operator)) throw new Error('Недопустимый оператор отбора');
        if (condition.value === null) {
            if (condition.operator === '=') return `${column} IS NULL`;
            if (condition.operator === '!=') return `${column} IS NOT NULL`;
            throw new Error('С NULL допустимы только операторы = и !=');
        }
        parameters.push(condition.value);
        return `${column} ${condition.operator} ?`;
    }).join(' AND ')}`;
}

function nonnegativeInteger(value: number, name: string): number {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} должно быть неотрицательным целым числом`);
    return value;
}

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
        sql += ' LIMIT ?';
        parameters.push(-1);
    }
    if (options.offset !== undefined) {
        sql += ' OFFSET ?';
        parameters.push(nonnegativeInteger(options.offset, 'Смещение страницы'));
    }
    return { sql, parameters };
}

export function insert(table: string, values: Readonly<Record<string, SqlValue>>): SqlQuery {
    const entries = Object.entries(values);
    if (entries.length === 0) throw new Error('Для INSERT нужно указать хотя бы одну колонку');
    const columns = entries.map(([column]) => sqlIdentifier(column)).join(', ');
    return {
        sql: `INSERT INTO ${sqlIdentifier(table)} (${columns}) VALUES (${entries.map(() => '?').join(', ')})`,
        parameters: entries.map(([, value]) => value),
    };
}

export function update(
    table: string,
    values: Readonly<Record<string, SqlValue>>,
    where: readonly SqlCondition[],
): SqlQuery {
    const entries = Object.entries(values);
    if (entries.length === 0) throw new Error('Для UPDATE нужно указать хотя бы одну колонку');
    if (where.length === 0) throw new Error('Для UPDATE нужно указать условия отбора');
    const parameters = entries.map(([, value]) => value);
    const assignments = entries.map(([column]) => `${sqlIdentifier(column)} = ?`).join(', ');
    return { sql: `UPDATE ${sqlIdentifier(table)} SET ${assignments}${conditions(where, parameters)}`, parameters };
}

export function remove(table: string, where: readonly SqlCondition[]): SqlQuery {
    if (where.length === 0) throw new Error('Для DELETE нужно указать условия отбора');
    const parameters: SqlValue[] = [];
    return { sql: `DELETE FROM ${sqlIdentifier(table)}${conditions(where, parameters)}`, parameters };
}
