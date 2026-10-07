import type { SqlQuery } from './sql.builder.js';

/** Запрос чтения с преобразованием хранимой строки; преобразование может завершиться ошибкой. */
export interface TypedSqlQuery<Row extends Record<string, unknown>> extends SqlQuery {
    readonly decodeRow: (row: Record<string, unknown>) => Row;
}
