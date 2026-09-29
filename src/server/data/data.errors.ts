import { Data } from 'effect';

/** Неверные данные операции: фильтр возвращает HTTP 400 и перечень полей для исправления. */
export class DataValidationError extends Data.TaggedError('DataValidationError')<{
    readonly message: string;
    readonly fields: readonly string[];
}> {}

/** Объект, действие или запись не найдены; фильтр возвращает HTTP 404. */
export class DataNotFoundError extends Data.TaggedError('DataNotFoundError')<{
    readonly message: string;
}> {}
