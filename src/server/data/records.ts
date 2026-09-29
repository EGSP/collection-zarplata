/**
 * Чтение записей и преобразование значений между базой, входными данными и ответом.
 *
 * Модуль общий для диспетчера и шагов проведения: оба читают записи и пишут значения полей
 * по одним правилам. Функции получают базу из окружения Effect, поэтому не зависят от
 * Nest-сервисов и работают внутри транзакции, которую открыл диспетчер.
 */
import { Effect, Schema } from 'effect';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { select, type SqlValue } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';

/** Представление строки после чтения из базы или проверки входных данных. */
export type RecordValue = Record<string, unknown>;

/** Имя таблицы выводится только из проверенных метаданных, а не из произвольной строки запроса. */
export function tableName(description: ObjectDescription): string {
    return `${description.kind}_${description.name}`;
}

/**
 * Собирает все ошибки Effect Schema за один проход и возвращает их вместе с путями полей.
 * Схема передаётся из метаданных; её ошибка становится ответом 400, а `location` задаёт
 * начало пути поля в ответе.
 */
export function validated<S extends Schema.Top>(schema: S, value: unknown, location: string): Effect.Effect<S['Type'], DataValidationError> {
    // Эти схемы состоят из синхронных полей метаданных и не требуют сервисов декодирования.
    return (Schema.decodeUnknownEffect(schema, { errors: 'all' })(value) as Effect.Effect<S['Type'], Schema.SchemaError>).pipe(
        Effect.mapError((error) => {
            const message = error.message.replaceAll('\n  at ', ' — поле ');
            // Форматтер Effect пишет путь в квадратных скобках; клиенту нужен путь от payload.
            const fields = [...message.matchAll(/поле ([^\n]+)/g)].map((match) =>
                `${location}.${match[1]}`.replaceAll(/\["([^"]+)"\]/g, '$1').replaceAll(/\[(\d+)\]/g, '.$1'),
            );
            return new DataValidationError({ message: `${location}: ${message}`, fields: fields.length ? fields : [location] });
        }),
    );
}

/**
 * Переводит проверенное значение поля в значение параметра SQL. Логические значения
 * становятся 0/1 для колонки INTEGER в таблице STRICT; прочие типы отклоняются с ошибкой 400.
 */
export function sqlValue(value: unknown): SqlValue {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' || typeof value === 'number') return value;
    throw new DataValidationError({ message: 'Неверное значение поля', fields: [] });
}

/**
 * Восстанавливает логические поля после чтения из SQLite и собирает регистратор движения из двух
 * колонок, в которых он хранится. Прочие значения возвращаются без преобразования.
 */
export function recordFromRow(row: RecordValue, description: ObjectDescription): RecordValue {
    const { recorderDocument, recorderGuid, ...record } = row;
    for (const field of description.fields) {
        if (field.kind === 'boolean' && record[field.name] !== null) record[field.name] = record[field.name] === 1;
        if (field.kind === 'recorder') record[field.name] = { document: recorderDocument, guid: recorderGuid };
    }
    return record;
}

/**
 * Читает запись справочника или документа вместе со всеми табличными частями, сохраняя порядок
 * строк по `lineNumber`. Отсутствующая запись завершается `DataNotFoundError`.
 */
export function loadRecord(description: ObjectDescription, guid: string): Effect.Effect<RecordValue, DataNotFoundError | DatabaseError, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const table = tableName(description);
        const row = yield* database.get<RecordValue>(select(table, { where: [{ column: 'guid', operator: '=', value: guid }] }));
        if (row === undefined) return yield* new DataNotFoundError({ message: `Запись ${description.name} с guid ${guid} не найдена` });
        const record = recordFromRow(row, description);
        for (const part of description.tableParts) {
            const rows = yield* database.all<RecordValue>(select(`${table}_${part.name}`, {
                where: [{ column: 'ownerGuid', operator: '=', value: guid }],
                orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
            }));
            // Служебные ключи связывают строку с владельцем, но не входят в значение табличной части.
            record[part.name] = rows.map(({ ownerGuid: _ownerGuid, lineNumber: _lineNumber, ...fields }) => {
                const result = { ...fields };
                for (const field of part.fields) if (field.kind === 'boolean' && result[field.name] !== null) result[field.name] = result[field.name] === 1;
                return result;
            });
        }
        return record;
    });
}
