/** Доступ конфигурации к чтению без обхода проверяемых действий записи. */
import { Effect } from 'effect';
import type { Database } from '../database/database.effect.js';

/**
 * Собственные действия, обработчики проведения и политики могут читать в текущей транзакции.
 * Изменять прикладные данные они должны через ActionDispatcher; платформенные шаги используют
 * исходный сервис Database, поэтому их запись не ограничивается этой обёрткой.
 */
export function readOnlyDatabase(database: Database): Database {
    const denied = () => Effect.die(new Error('Из конфигурации изменять базу нужно через ActionDispatcher'));
    return {
        get: (query) => database.get(query),
        all: (query) => database.all(query),
        run: denied,
        transaction: denied,
    };
}
