import { Context, Effect } from 'effect';

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
