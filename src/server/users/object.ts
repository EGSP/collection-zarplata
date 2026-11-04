/** Публичная схема пользователей ИБ. Секреты не являются полями объекта даже для администратора. */
import { Effect } from 'effect';
import { accessSchema, emptyAccess } from '../authorization/access-schema.js';
import type { UserSession } from './descriptions.js';
import { catalog } from '../metadata/builders.js';

// Служебные действия исполняет адаптер хранения; заглушка не должна работать без него.
const platformHandler = () => Effect.die(new Error('Не подключён обработчик объекта платформы'));

const definition = catalog('users').title('Пользователи')
    .form(form => form.title('name', 'Имя'))
    .field('disabledAt', field => field.dateTime().title('Отключён с'))
    .tablePart('roles', part => part.title('Роли').field('role', field => field.string().title('Роль').required()))
    .action('setPin', action => action.title('Установить PIN').placement('hidden').access(emptyAccess)
        .input(input => input.field('guid', field => field.string().required()).field('pin', field => field.string().title('PIN').required().minimumLength(4).maximumLength(12)))
        .handle(platformHandler))
    .function('sessions', action => action.title('Сессии').access(emptyAccess)
        .input(input => input.field('guid', field => field.string().required())).handle((): Effect.Effect<readonly UserSession[]> => platformHandler()))
    .action('revokeSession', action => action.title('Отключить сессию').placement('hidden').access(emptyAccess)
        .input(input => input.field('guid', field => field.string().required()).field('sessionGuid', field => field.string().required())).handle(platformHandler))
    .function('roleOptions', action => action.title('Доступные роли').access(emptyAccess).handle((): Effect.Effect<readonly { name: string; title: string; all: boolean }[]> => platformHandler()));

/** Группы прав независимы от вкладок и раскладки формы. */
export const Users = definition.withAccess(accessSchema(definition)
    .defineGroup('account', ['name'], 'Учётная запись')
    .defineGroup('authorization', ['disabledAt', 'roles'], 'Авторизация'));
