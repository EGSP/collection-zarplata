/**
 * Общий язык числовых формул. Описание передаётся в SDUI, поэтому сервер и форма
 * исполняют одно выражение без импорта конфигурации и без выполнения строкового кода.
 * Пустое значение считается нулём; деление на ноль и бесконечный результат отклоняются.
 */
export type Formula =
    | { readonly operation: 'value'; readonly value: number }
    | { readonly operation: 'field'; readonly field: string }
    | { readonly operation: 'sum'; readonly part: string; readonly field: string }
    | { readonly operation: 'add' | 'subtract' | 'multiply' | 'divide'; readonly left: Formula; readonly right: Formula }
    | { readonly operation: 'round'; readonly value: Formula };

/** Фабрика выражений; деньги округляют в целых копейках через round(). */
export const formula = {
    value: (value: number): Formula => ({ operation: 'value', value }),
    field: (field: string): Formula => ({ operation: 'field', field }),
    sum: (part: string, field: string): Formula => ({ operation: 'sum', part, field }),
    add: (left: Formula, right: Formula): Formula => ({ operation: 'add', left, right }),
    subtract: (left: Formula, right: Formula): Formula => ({ operation: 'subtract', left, right }),
    multiply: (left: Formula, right: Formula): Formula => ({ operation: 'multiply', left, right }),
    divide: (left: Formula, right: Formula): Formula => ({ operation: 'divide', left, right }),
    round: (value: Formula): Formula => ({ operation: 'round', value }),
};

/** Поле с необязательной формулой; общий контракт серверного описания и SDUI. */
export interface FormulaField {
    readonly name: string;
    readonly computed?: Formula | null;
}

/** Проверяет ссылки выражения и возвращает его зависимости в текущей строке. */
export function formulaDependencies(expression: Formula, fields: ReadonlyArray<FormulaField>, parts: ReadonlyArray<{ readonly name: string; readonly fields: ReadonlyArray<FormulaField> }>): ReadonlyArray<string> {
    switch (expression.operation) {
        case 'value':
            if (!Number.isFinite(expression.value)) throw new Error('Константа формулы должна быть конечным числом');
            return [];
        case 'field':
            if (!fields.some((field) => field.name === expression.field)) throw new Error(`В формуле нет поля «${expression.field}»`);
            return [expression.field];
        case 'sum':
            if (!parts.find((part) => part.name === expression.part)?.fields.some((field) => field.name === expression.field)) throw new Error(`В формуле нет колонки «${expression.part}.${expression.field}»`);
            return [];
        case 'round': return formulaDependencies(expression.value, fields, parts);
        default: return [...formulaDependencies(expression.left, fields, parts), ...formulaDependencies(expression.right, fields, parts)];
    }
}

/** Вычисляет выражение по значениям строки или шапки; результат обязан быть конечным. */
export function evaluateFormula(expression: Formula, record: Readonly<Record<string, unknown>>): number {
    const number = (value: unknown): number => {
        if (value === null || value === undefined) return 0;
        if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Формула ожидает конечное число');
        return value;
    };
    let result: number;
    switch (expression.operation) {
        case 'value': result = expression.value; break;
        case 'field': result = number(record[expression.field]); break;
        case 'sum': result = ((record[expression.part] ?? []) as ReadonlyArray<Record<string, unknown>>).reduce((sum, row) => sum + number(row[expression.field]), 0); break;
        case 'round': result = Math.round(evaluateFormula(expression.value, record)); break;
        case 'add': result = evaluateFormula(expression.left, record) + evaluateFormula(expression.right, record); break;
        case 'subtract': result = evaluateFormula(expression.left, record) - evaluateFormula(expression.right, record); break;
        case 'multiply': result = evaluateFormula(expression.left, record) * evaluateFormula(expression.right, record); break;
        case 'divide': result = evaluateFormula(expression.left, record) / evaluateFormula(expression.right, record); break;
    }
    if (!Number.isFinite(result)) throw new Error('Формула дала бесконечное значение или деление на ноль');
    return result;
}

/** Вычисляет поля в порядке зависимостей, независимо от порядка объявления; цикл даёт ошибку. */
export function computeFields(fields: ReadonlyArray<FormulaField>, values: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const result = { ...values };
    const visiting = new Set<string>();
    const completed = new Set<string>();
    const compute = (field: FormulaField): void => {
        if (!field.computed || completed.has(field.name)) return;
        if (visiting.has(field.name)) throw new Error(`Цикл формул в поле «${field.name}»`);
        visiting.add(field.name);
        const visit = (expression: Formula): void => {
            if (expression.operation === 'field') {
                const dependency = fields.find((candidate) => candidate.name === expression.field);
                if (dependency !== undefined) compute(dependency);
            } else if (expression.operation === 'round') visit(expression.value);
            else if ('left' in expression) { visit(expression.left); visit(expression.right); }
        };
        visit(field.computed);
        result[field.name] = evaluateFormula(field.computed, result);
        visiting.delete(field.name);
        completed.add(field.name);
    };
    fields.forEach(compute);
    return result;
}
