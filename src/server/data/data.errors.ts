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

/** Политика записи или ограничение итога регистра запретили изменение; фильтр возвращает HTTP 409 с причиной. */
export class DataPolicyError extends Data.TaggedError('DataPolicyError')<{
    readonly message: string;
}> {}
