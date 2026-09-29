import { Data } from 'effect';

/** Ошибка входных данных с перечнем полей, которые нужно исправить. */
export class DataValidationError extends Data.TaggedError('DataValidationError')<{
    readonly message: string;
    readonly fields: readonly string[];
}> {}

/** Запрошенный объект, действие или запись отсутствует. */
export class DataNotFoundError extends Data.TaggedError('DataNotFoundError')<{
    readonly message: string;
}> {}
