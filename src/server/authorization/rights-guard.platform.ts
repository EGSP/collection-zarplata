import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { roles as configurationRoles } from '../../configuration/roles.js';
import type { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { RightsDeniedError } from './authorization.errors.js';
import type { Right } from './rights.js';
import { commitRoles, type RoleDescription } from './roles.js';
import { userRoleNames } from './user-roles.js';

/** Права одного пользователя, собранные из его ролей. */
export interface UserRights {
    /** Роли пользователя, которые описаны в конфигурации. */
    readonly roles: ReadonlyArray<string>;
    allows(right: Right): boolean;
}

/**
 * Бизнес-гвард: единственный механизм платформы, который решает, есть ли у пользователя право.
 *
 * Все действия с данными идут через один маршрут, а цель операции известна только из тела
 * запроса. Поэтому права проверяются не на маршруте, а там, где цель уже найдена: диспетчер
 * вызывает гвард перед каждой операцией, в том числе вложенной. Nest-гвард `RightsGuardNest`
 * для отдельных маршрутов и отбор описаний для клиента вызывают этот же класс, и другого кода,
 * который сравнивает права с ролями, в платформе нет.
 *
 * Методы возвращают Effect и получают базу из окружения. Внутри действия это дескриптор его
 * транзакции, поэтому проверка видит те же данные, что и само действие. Роли пользователя
 * читаются при каждой проверке: изменение ролей действует со следующего действия, и хранить
 * права в токене или в памяти не нужно.
 *
 * Роли собираются в конструкторе: ошибка в их описании останавливает запуск до приёма запросов.
 */
@Injectable()
export class RightsGuardPlatform {
    /** Роли конфигурации в порядке объявления. */
    readonly roles: ReadonlyArray<RoleDescription>;

    constructor() {
        // Сборка синхронна: проверка ролей не обращается к внешним ресурсам.
        this.roles = Effect.runSync(commitRoles(configurationRoles));
    }

    /**
     * Права пользователя. У запроса без пользователя и у пользователя без ролей прав нет.
     * Роль, имя которой осталось в базе после удаления из конфигурации, прав не даёт.
     */
    rightsOf(userGuid: string | null): Effect.Effect<UserRights, DatabaseError, Database> {
        return Effect.gen(function* (this: RightsGuardPlatform) {
            const names = userGuid === null ? [] : yield* userRoleNames(userGuid);
            const granted = this.roles.filter((role) => names.includes(role.name));
            const rights: UserRights = {
                roles: granted.map((role) => role.name),
                allows: (right) => granted.some((role) => role.all || role.rights.has(right.key)),
            };
            return rights;
        }.bind(this));
    }

    /** Завершается `RightsDeniedError` с первым правом из списка, которого у пользователя нет. */
    require(userGuid: string | null, ...rights: ReadonlyArray<Right>): Effect.Effect<void, RightsDeniedError | DatabaseError, Database> {
        return Effect.gen(function* (this: RightsGuardPlatform) {
            const granted = yield* this.rightsOf(userGuid);
            const missing = rights.find((right) => !granted.allows(right));
            if (missing !== undefined) {
                return yield* new RightsDeniedError({ message: `Недостаточно прав: нужно право ${missing.key}`, right: missing.key });
            }
        }.bind(this));
    }
}
