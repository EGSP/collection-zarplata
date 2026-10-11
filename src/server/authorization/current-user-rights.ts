/**
 * Проверка права текущего пользователя из кода конфигурации.
 *
 * Диспетчер проверяет право на само действие, но прикладной запрет иногда зависит от данных:
 * записать документ может каждый, у кого есть право записи, а изменить в нём отдельное поле —
 * только пользователь с особым правом. Такое условие проверяют политика записи, собственное
 * действие или обработчик проведения, и для этого им нужен ответ, есть ли право у пользователя.
 *
 * Конфигурация не читает роли сама: сервис этого модуля передаёт вопрос бизнес-гварду, и второго
 * кода, который сравнивает права с ролями, не появляется. Сервис приходит через окружение Effect,
 * а не аргументом обработчика: у собственного действия и обработчика проведения аргумента для
 * него нет. Диспетчер создаёт сервис один раз на запрос и связывает его с пользователем, который
 * начал цепочку, поэтому вложенное действие проверяет права того же пользователя.
 */
import { Context, Effect } from 'effect';
import type { DatabaseError } from '../database/database.errors.js';
import type { RightsDeniedError } from './authorization.errors.js';
import type { Right } from './rights.js';

/**
 * Права пользователя, который начал цепочку запроса. Роли читаются при каждом вызове в транзакции
 * действия, поэтому изменение ролей действует со следующей проверки. У запроса без пользователя
 * прав нет.
 */
export interface CurrentUserRights {
    /** Отвечает, есть ли у пользователя право; отсутствие права ошибкой не считается. */
    has(right: Right): Effect.Effect<boolean, DatabaseError>;
    /**
     * Завершается `RightsDeniedError` с первым правом из списка, которого у пользователя нет.
     * Это та же ошибка, что и при отказе диспетчера: API отвечает 403 с ключом права.
     */
    require(...rights: ReadonlyArray<Right>): Effect.Effect<void, RightsDeniedError | DatabaseError>;
}

/** Тег сервиса; диспетчер передаёт его в окружение каждого действия запроса. */
export const CurrentUserRights = Context.Service<CurrentUserRights>('CurrentUserRights');

/** Отвечает, есть ли право у текущего пользователя. Право берётся из объекта `Rights`. */
export function hasRight(right: Right): Effect.Effect<boolean, DatabaseError, CurrentUserRights> {
    return Effect.flatMap(Effect.service(CurrentUserRights), (service) => service.has(right));
}

/**
 * Прерывает действие, если у текущего пользователя нет хотя бы одного из перечисленных прав.
 * Отказ откатывает транзакцию всего запроса, как и отказ диспетчера.
 */
export function requireRight(...rights: ReadonlyArray<Right>): Effect.Effect<void, RightsDeniedError | DatabaseError, CurrentUserRights> {
    return Effect.flatMap(Effect.service(CurrentUserRights), (service) => service.require(...rights));
}
