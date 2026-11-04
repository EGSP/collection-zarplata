import { Context, Effect } from 'effect';
import type { FunctionMap } from '../metadata/builders.js';

/** Контекст одного действия в цепочке запроса; передаётся через окружение Effect без параметров обработчика. */
export interface ActionContext {
    /** Идентификатор вошедшего пользователя всей цепочки. */
    readonly userGuid: string | null;
    /** Общий идентификатор внешнего запроса и всех вложенных действий. */
    readonly traceGuid: string;
    /** Идентификатор именно этого вызова действия. */
    readonly actionGuid: string;
    /** Идентификатор вызывающего действия; у внешнего вызова равен null. */
    readonly parentActionGuid: string | null;
}

/** Тег контекста, который обработчик собственного действия получает из окружения Effect. */
export const ActionContext = Context.Service<ActionContext>('ActionContext');

/** Вложенный вызов вновь проходит поиск действия и проверку входных данных в диспетчере. */
export interface ActionDispatcher {
    /** Принимает такую же операцию, как эндпоинт, и выполняет её внутри текущей транзакции. */
    execute(operation: unknown): Effect.Effect<unknown, unknown, ActionContext | ActionDispatcher>;
}

/** Тег диспетчера для собственных действий конфигурации. */
export const ActionDispatcher = Context.Service<ActionDispatcher>('ActionDispatcher');

/**
 * Вызов функции объекта из кода сервера. Принимает только функции: через него нельзя выполнить
 * изменяющее действие, поэтому его получают и обработчики функций. Вызов идёт тем же путём, что
 * операция `{ target, function, payload }` эндпоинта: в текущей транзакции, с проверкой права
 * того же пользователя и входных данных.
 */
export interface FunctionDispatcher {
    call(target: { readonly kind: string; readonly name: string }, name: string, payload: unknown): Effect.Effect<unknown, unknown>;
}

/** Тег диспетчера функций. */
export const FunctionDispatcher = Context.Service<FunctionDispatcher>('FunctionDispatcher');

/**
 * Объект, функцию которого вызывают: билдер объекта или ссылка из `Objects`. Ссылка нужна там,
 * где импорт билдера замкнул бы файлы конфигурации в круг: она несёт сигнатуры только в типах.
 */
interface FunctionOwner {
    readonly kind: string;
    readonly name: string;
    readonly '~functions': FunctionMap;
}

/** Имена функций объекта. */
type FunctionName<Owner extends FunctionOwner> = keyof Owner['~functions'] & string;

/** Сигнатура функции `Name` объекта. */
type OwnerSignature<Owner extends FunctionOwner, Name extends FunctionName<Owner>> = Owner['~functions'][Name];

/**
 * Вызывает функцию объекта из действия, проведения, политики или другой функции. Имя функции,
 * входные данные и тип результата проверяет компилятор по билдеру объекта:
 *
 * ```ts
 * const figures = yield* callFunction(SaleInstallment, 'figures', { date: null, installments: [{ guid }] });
 * ```
 *
 * Результат приходит из обработчика функции после проверки входных данных диспетчером.
 */
export function callFunction<Owner extends FunctionOwner, const Name extends FunctionName<Owner>>(
    object: Owner,
    name: Name,
    input: OwnerSignature<Owner, Name>['input'],
): Effect.Effect<OwnerSignature<Owner, Name>['output'], unknown, FunctionDispatcher> {
    return Effect.gen(function* () {
        const dispatcher = yield* FunctionDispatcher;
        // Диспетчер проверил входные данные по описанию функции, а результат вернул её обработчик.
        return (yield* dispatcher.call({ kind: object.kind, name: object.name }, name, input)) as OwnerSignature<Owner, Name>['output'];
    });
}
