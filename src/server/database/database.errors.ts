import { Data } from 'effect';

/**
 * Ошибка драйвера с названием операции, на которой она возникла.
 * Исходная причина остаётся в `cause` для диагностики, а сообщение пользователю не раскрывает
 * текст SQL, параметры запроса и подробности драйвера.
 */
export class DatabaseError extends Data.TaggedError('DatabaseError')<{
    readonly operation: string;
    readonly cause: unknown;
}> {
    override get message(): string {
        return `Ошибка базы данных при операции «${this.operation}»`;
    }
}
