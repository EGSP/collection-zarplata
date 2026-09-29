import { Context, Effect } from 'effect';

/** Контекст одного действия в цепочке запроса. Вход без авторизации оставляет userGuid пустым. */
export interface ActionContext {
    readonly userGuid: string | null;
    readonly traceGuid: string;
    readonly actionGuid: string;
    readonly parentActionGuid: string | null;
}

/** Тег контекста, который обработчик собственного действия получает из окружения Effect. */
export const ActionContext = Context.Service<ActionContext>('ActionContext');

/** Вложенный вызов вновь проходит поиск действия и проверку входных данных в диспетчере. */
export interface ActionDispatcher {
    execute(operation: unknown): Effect.Effect<unknown, unknown, ActionContext | ActionDispatcher>;
}

/** Тег диспетчера для собственных действий конфигурации. */
export const ActionDispatcher = Context.Service<ActionDispatcher>('ActionDispatcher');
