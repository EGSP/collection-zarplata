/** Публичная схема пользователей ИБ. Секреты не являются полями объекта даже для администратора. */
import { Effect } from 'effect';
import { accessSchema, emptyAccess } from '../authorization/access-schema.js';
import { catalog } from '../metadata/builders.js';
import type { UserAdministration } from './descriptions.js';

/** Описания для конфигурации и прав используются без запуска действий. */
const unbound = Effect.die(new Error('Не подключены служебные операции пользователей'));

/** Метаданные подключают служебные обработчики только в серверном экземпляре справочника. */
export function usersCatalog(administration?: UserAdministration) {
    const definition = catalog('users').title('Пользователи')
        .form(form => form.title('name', 'Имя'))
        .field('disabledAt', field => field.dateTime().title('Отключён с'))
        .tablePart('roles', part => part.title('Роли').field('role', field => field.string().title('Роль').required()))
        .action('setPin', action => action.title('Установить PIN').placement('hidden').access(emptyAccess)
            .input(input => input.field('guid', field => field.string().required()).field('pin', field => field.string().title('PIN').required().minimumLength(4).maximumLength(12)))
            .handle(input => administration?.setPin(input) ?? unbound))
        .function('sessions', action => action.title('Сессии').access(emptyAccess)
            .input(input => input.field('guid', field => field.string().required()))
            .handle(input => administration?.sessions(input) ?? unbound))
        .action('revokeSession', action => action.title('Отключить сессию').placement('hidden').access(emptyAccess)
            .input(input => input.field('guid', field => field.string().required()).field('sessionGuid', field => field.string().required()))
            .handle(input => administration?.revokeSession(input) ?? unbound))
        .function('roleOptions', action => action.title('Доступные роли').access(emptyAccess)
            .handle(() => administration?.roleOptions ?? unbound));

    // Группы прав независимы от вкладок и раскладки формы.
    return definition.withAccess(accessSchema(definition)
        .defineGroup('account', ['name'], 'Учётная запись')
        .defineGroup('authorization', ['disabledAt', 'roles'], 'Авторизация'));
}

/** Встроенный справочник, доступный конфигурации для форм, ссылок и прав. */
export const Users = usersCatalog();
