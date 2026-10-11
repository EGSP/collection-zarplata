/**
 * Чтение полных записей и проверка входных данных по метаданным.
 *
 * Модуль общий для диспетчера и шагов проведения: оба читают записи и проверяют входные данные
 * по одним правилам. Запросы строит общий билдер, а функции получают базу из окружения Effect и не зависят от
 * Nest-сервисов и работают внутри транзакции, которую открыл диспетчер.
 */
import { Effect, Schema } from 'effect';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { query, type SqlCondition } from '../database/sql.builder.js';
import { guidPattern } from '../common/guid.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import type { FilterOperator } from '../ui/descriptions.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';

/** Представление строки после чтения из базы или проверки входных данных. */
export type RecordValue = Record<string, unknown>;

/** Страница списка после проверки: номер с единицы, размер от 1 до 500 и смещение первой строки. */
export interface PageOptions {
    readonly page: number;
    readonly pageSize: number;
    readonly offset: number;
}

/**
 * Операторы SQL для способов сравнения из формата описаний. `contains` в SQL не переводится:
 * `LIKE` в Turso считает `%` и `_` шаблоном и не складывает регистр кириллицы.
 */
export const sqlOperators: { readonly [Operator in Exclude<FilterOperator, 'contains'>]: SqlCondition['operator'] } = {
    equals: '=',
    notEquals: '!=',
    greater: '>',
    greaterOrEqual: '>=',
    less: '<',
    lessOrEqual: '<=',
};

/** Отклоняет массив и null до обращения к полям тела запроса; location попадает в ответ 400. */
export function objectValue(value: unknown, location: string): RecordValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new DataValidationError({ message: `Ожидается объект: ${location}`, fields: [location] });
    }
    return value as RecordValue;
}

/** Извлекает обязательную непустую строку из непроверенного тела запроса. */
export function stringValue(value: unknown, location: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new DataValidationError({ message: `Нужно указать ${location}`, fields: [location] });
    }
    return value;
}

/** Извлекает обязательный guid; неверный формат даёт 400 до запроса к базе, а не пустой результат. */
export function guidValue(value: unknown, location: string): string {
    const guid = stringValue(value, location);
    if (!guidPattern.test(guid)) throw new DataValidationError({ message: 'Ожидается guid', fields: [location] });
    return guid;
}

/** Принимает только точно представимое целое число; значение по умолчанию действует лишь при отсутствии поля. */
function nonnegative(value: unknown, location: string, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new DataValidationError({ message: `${location}: ожидается неотрицательное целое число`, fields: [location] });
    }
    return value as number;
}

/**
 * Проверяет `page` и `pageSize` из payload списка. Без них действует первая страница по 50 строк;
 * размер ограничен 500 строками, чтобы один запрос не выгружал таблицу целиком.
 */
export function pageOptions(options: RecordValue): PageOptions {
    const page = nonnegative(options['page'], 'payload.page', 1);
    if (page < 1) throw new DataValidationError({ message: 'Номер страницы должен быть больше нуля', fields: ['payload.page'] });
    const pageSize = nonnegative(options['pageSize'], 'payload.pageSize', 50);
    if (pageSize < 1 || pageSize > 500) throw new DataValidationError({ message: 'Размер страницы должен быть от 1 до 500', fields: ['payload.pageSize'] });
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset)) throw new DataValidationError({ message: 'Номер страницы слишком велик', fields: ['payload.page'] });
    return { page, pageSize, offset };
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
            // Форматтер Effect пишет путь в квадратных скобках: `["lines"][0]["text"]`. Клиенту нужен путь
            // от payload через точки, поэтому каждая часть пути, и имя, и номер строки, получает точку перед собой.
            const fields = [...message.matchAll(/поле ([^\n]+)/g)].map((match) =>
                `${location}${match[1]}`.replaceAll(/\["([^"]+)"\]/g, '.$1').replaceAll(/\[(\d+)\]/g, '.$1'),
            );
            return new DataValidationError({ message: `${location}: ${message}`, fields: fields.length ? fields : [location] });
        }),
    );
}

/**
 * Читает запись справочника или документа вместе со всеми табличными частями, сохраняя порядок
 * строк по `lineNumber`. Отсутствующая запись завершается `DataNotFoundError`.
 */
export function loadRecord(description: ObjectDescription, guid: string): Effect.Effect<RecordValue, DataNotFoundError | DatabaseError, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const builder = query(description);
        const row = yield* database.get<RecordValue>(builder.select({ where: [{ column: 'guid', operator: '=', value: guid }] }));
        if (row === undefined) return yield* new DataNotFoundError({ message: `Запись ${description.name} с guid ${guid} не найдена` });
        const record = { ...row };
        for (const part of description.tableParts) {
            const rows = yield* database.all<RecordValue>(builder.tablePart(part.name).select({
                where: [{ column: 'ownerGuid', operator: '=', value: guid }],
                orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
            }));
            // Служебные ключи связывают строку с владельцем, но не входят в значение табличной части.
            record[part.name] = rows.map(({ ownerGuid: _ownerGuid, lineNumber: _lineNumber, ...fields }) => fields);
        }
        return record;
    });
}
