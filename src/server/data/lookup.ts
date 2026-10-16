/**
 * Стандартное действие `lookup`: строки окна подбора записей для полей ссылки.
 *
 * Строки ищет функция подбора из конфигурации, а платформа только проверяет вход и результат.
 * Поэтому клиент не знает, как устроена выборка: он передаёт строку поиска и страницу и получает
 * готовые строки с `guid` записи и значениями колонок.
 */
import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { readOnlyDatabase } from './read-only-database.js';
import { objectValue, pageOptions, type RecordValue } from './records.js';

/** Наибольший размер страницы подбора: окно показывает таблицу, а не выгрузку. */
const maximumPageSize = 100;

/** Ответ действия: строки страницы и общее число найденных строк. */
export interface LookupResponse {
    readonly total: number;
    readonly rows: ReadonlyArray<RecordValue>;
}

/**
 * Проверяет вход, вызывает функцию подбора и проверяет её результат. Функция читает базу
 * в транзакции запроса, но изменять её не может: подбор вызывается при каждом открытии окна
 * и вводе поиска, и побочные изменения были бы незаметны пользователю.
 *
 * Результат проверяется на форму, а не на значения колонок: колонки описаны для показа, и окно
 * само форматирует значение по виду колонки. Строка без `guid` отклоняется: выбрать её нельзя.
 */
export function lookupAction(description: ObjectDescription, payload: unknown): Effect.Effect<LookupResponse, unknown, Database> {
    return Effect.gen(function* () {
        const lookup = description.lookup;
        if (lookup === null) {
            return yield* new DataNotFoundError({ message: `У ${description.kind}.${description.name} нет подбора` });
        }
        const options = objectValue(payload, 'payload');
        const search = options['search'] ?? '';
        if (typeof search !== 'string') return yield* new DataValidationError({ message: 'Строка поиска должна быть строкой', fields: ['payload.search'] });
        const page = pageOptions(options);
        if (page.pageSize > maximumPageSize) {
            return yield* new DataValidationError({ message: `Размер страницы подбора не больше ${maximumPageSize}`, fields: ['payload.pageSize'] });
        }
        const database = yield* Database;
        // Описание хранит функцию со стёртым типом аргумента; вход собран по контракту LookupInput.
        const result = lookup.search({ search, page: page.page, pageSize: page.pageSize, offset: page.offset } as never);
        if (!Effect.isEffect(result)) return yield* Effect.die(new Error('Функция подбора должна вернуть Effect'));
        const value = yield* Effect.provideService(result as Effect.Effect<unknown, unknown, Database>, Database, readOnlyDatabase(database));
        const response = value as Partial<LookupResponse> | null;
        if (response === null || typeof response !== 'object' || typeof response.total !== 'number' || !Array.isArray(response.rows)
            || response.rows.some((row) => row === null || typeof row !== 'object' || typeof row['guid'] !== 'string')) {
            return yield* Effect.die(new Error(`Подбор ${description.kind}.${description.name} вернул результат без total или строк с guid`));
        }
        return { total: response.total, rows: response.rows };
    });
}
