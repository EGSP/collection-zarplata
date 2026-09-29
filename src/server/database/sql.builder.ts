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

/** Колонка и направление сортировки; направление ограничено двумя ключевыми словами SQL. */
export interface SqlOrder {
    readonly column: string;
    readonly direction: 'ASC' | 'DESC';
}

/** Настройки выборки. Без `columns` выбираются все колонки, без `limit` — все строки. */
export interface SelectOptions {
    readonly columns?: readonly string[];
    readonly where?: readonly SqlCondition[];
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

/** Добавляет значения отбора в том же порядке, в каком в SQL появляются маркеры `?`. */
function conditions(where: readonly SqlCondition[] | undefined, parameters: SqlValue[]): string {
    if (where === undefined || where.length === 0) return '';
    return ` WHERE ${where.map((condition) => {
        const column = sqlIdentifier(condition.column);
        if (!operators.has(condition.operator)) throw new Error('Недопустимый оператор отбора');
        if (condition.value === null) {
            // Сравнение `= NULL` в SQL не даёт совпадения; для него нужны IS NULL / IS NOT NULL.
            if (condition.operator === '=') return `${column} IS NULL`;
            if (condition.operator === '!=') return `${column} IS NOT NULL`;
            throw new Error('С NULL допустимы только операторы = и !=');
        }
        parameters.push(condition.value);
        return `${column} ${condition.operator} ?`;
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
    where: readonly SqlCondition[],
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
export function remove(table: string, where: readonly SqlCondition[]): SqlQuery {
    if (where.length === 0) throw new Error('Для DELETE нужно указать условия отбора');
    const parameters: SqlValue[] = [];
    return { sql: `DELETE FROM ${sqlIdentifier(table)}${conditions(where, parameters)}`, parameters };
}
