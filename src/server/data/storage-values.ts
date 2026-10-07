/** Общие преобразования значений полей между записью и хранением в SQLite. */
import type { SqlValue } from '../database/sql.builder.js';
import type { FieldKind } from '../metadata/descriptions.js';
import { DataValidationError } from './data.errors.js';

/**
 * Переводит проверенное значение поля в значение параметра SQL. Логические значения
 * становятся 0/1 для колонки INTEGER, полные ссылки становятся JSON с устойчивым порядком
 * свойств для сравнения в SQL. Неподдерживаемые значения отклоняются с ошибкой 400.
 */
export function sqlValue(value: unknown): SqlValue {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' || typeof value === 'number') return value;
    if (typeof value === 'object' && !Array.isArray(value)) {
        const reference = value as Record<string, unknown>;
        if ((reference['kind'] === 'catalog' || reference['kind'] === 'document') && typeof reference['name'] === 'string' && typeof reference['guid'] === 'string') {
            return JSON.stringify({ kind: reference['kind'], name: reference['name'], guid: reference['guid'] });
        }
    }
    throw new DataValidationError({ message: 'Неверное значение поля', fields: [] });
}

/** Восстанавливает одно хранимое значение; деньги уже представлены целым числом копеек. */
export function fieldValueFromRow(value: unknown, kind: FieldKind): unknown {
    if (value === null || value === undefined) return value;
    if (kind === 'boolean') return value === 1;
    if (kind === 'objectReference' && typeof value === 'string') return JSON.parse(value);
    return value;
}
