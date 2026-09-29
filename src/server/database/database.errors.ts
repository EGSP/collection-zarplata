import { Data } from 'effect';

/** Ошибка при обращении к базе данных. */
export class DatabaseError extends Data.TaggedError('DatabaseError')<{
    readonly operation: string;
    readonly cause: unknown;
}> {
    override get message(): string {
        return `Ошибка базы данных при операции «${this.operation}»`;
    }
}
