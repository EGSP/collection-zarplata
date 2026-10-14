import { Data } from 'effect';

/**
 * Шаг применения первичных данных не выполнен. Сообщение называет шаг и причину: ошибка
 * останавливает сервер, и оператор видит её только в логе запуска.
 */
export class InitialDataError extends Data.TaggedError('InitialDataError')<{
    readonly message: string;
}> {}
