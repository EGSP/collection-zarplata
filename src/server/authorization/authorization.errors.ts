import { Data } from 'effect';

/**
 * У пользователя нет нужного права. Единый эндпоинт и Nest-гвард возвращают HTTP 403;
 * `right` — ключ недостающего права, по нему видно, какую роль нужно назначить.
 */
export class RightsDeniedError extends Data.TaggedError('RightsDeniedError')<{
    readonly message: string;
    readonly right: string;
    readonly code?: string;
    readonly target?: { readonly kind: string; readonly name: string };
    readonly path?: string;
    readonly required?: string;
    readonly actual?: string;
    readonly chain?: readonly string[];
}> {}
