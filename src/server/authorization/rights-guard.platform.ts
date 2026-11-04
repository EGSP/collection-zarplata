import { configurationModules } from '../../configuration/configuration.generated.js';
import { isObjectBuilder } from '../metadata/builders.js';
import { resolveAccess, type AccessDefinition, type AccessTarget, type AccessDecision } from './access-schema.js';
import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { roles as configurationRoles } from '../../configuration/roles.js';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { RightsDeniedError } from './authorization.errors.js';
import type { Right } from './rights.js';
import { commitRoles, type RoleDescription } from './roles.js';
import { userRoleNames } from './user-roles.js';

/** Права одного пользователя, собранные из его ролей. */
export interface UserRights {
    /** Роли пользователя, которые описаны в конфигурации. */
    readonly roles: ReadonlyArray<string>;
    readonly definitions: readonly AccessDefinition[];
    readonly full: boolean;
    decision(target: AccessTarget, path: string): AccessDecision;
    allows(right: Right): boolean;
    /** Все роли-основания, включая полный доступ. Пустой список означает отсутствие права. */
    grantedBy(right: Right): ReadonlyArray<RoleDescription>;
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
     * Собирает права по уже прочитанным назначениям. Проверка операции и объяснение доступа
     * используют одно правило: объединение известных ролей с учётом полного доступа.
     */
    rightsFromRoles(names: ReadonlyArray<string>, settings: readonly AccessSetting[] = [], userGuid: string | null = null): UserRights {
        const assigned = new Set(names);
        const roles = this.roles.filter((role) => assigned.has(role.name));
        const defaults = configurationModules.flatMap(module => Object.values(module.exports).filter(isObjectBuilder).map(object => object['~state'].access));
        const definitions: AccessDefinition[] = [...defaults, ...roles.map(role => {
            const legacy = [...role.rights].flatMap(key => {
                const [kind, name, permission, ...rest] = key.split('.');
                if (!['catalog', 'document', 'register', 'informationRegister'].includes(kind!)) return [];
                return [{ target: { kind: kind as AccessTarget['kind'], name: name! }, path: permission === 'read' || permission === 'write' ? 'fields' : permission === 'post' ? 'actions.post' : [permission, ...rest].join('.'), level: permission === 'read' ? 'read' as const : permission === 'write' ? 'edit' as const : 'allow' as const }];
            });
            const overrides = settings.filter(setting => setting.subjectKind === 'role' && setting.subject === role.name);
            return { groups: role.access.groups, entries: [...role.access.entries, ...legacy].filter(entry => !overrides.some(setting => setting.kind === entry.target.kind && setting.name === entry.target.name && setting.path === entry.path)).concat(overrides.map(settingEntry)) };
        }), { groups: [], entries: settings.filter(setting => setting.subjectKind === 'user' && setting.subject === userGuid).map(settingEntry) }];
        const full = roles.some(role => role.all);
        const decision = (target: AccessTarget, path: string) => resolveAccess(definitions, target, path, full);
        const allows = (right: Right) => {
            const [kind, name, ...segments] = right.key.split('.');
            if (!['catalog', 'document', 'register', 'informationRegister'].includes(kind!)) return roles.some(role => role.all || role.rights.has(right.key));
            const target = { kind: kind as AccessTarget['kind'], name: name! };
            const path = segments[0] === 'read' || segments[0] === 'write' ? 'fields' : segments[0] === 'post' ? 'actions.post' : segments.join('.');
            const result = decision(target, path);
            if (segments[0] === 'read' || segments[0] === 'write') {
                const object = configurationModules.flatMap(module => Object.values(module.exports).filter(isObjectBuilder)).find(object => object.kind === kind && object.name === name);
                const state = object?.withStandardFields()['~state'];
                const names = state === undefined ? [] : [...state.fields.map(field => field.name), ...state.tableParts.flatMap(part => part.fields.map(field => `${part.name}.${field.name}`))];
                return names.some(name => { const level = decision(target, `fields.${name}`).level; return segments[0] === 'write' ? level === 'edit' : level === 'edit' || level === 'read'; });
            }
            return result.level === 'allow';
        };
        const grantedBy = (right: Right) => allows(right) ? roles.filter(role => this.rightsFromRoles([role.name], settings).allows(right)) : [];
        return { roles: roles.map(role => role.name), definitions, full, decision, allows, grantedBy };
    }

    /**
     * Права пользователя. У запроса без пользователя и у пользователя без ролей прав нет.
     * Роль, имя которой осталось в базе после удаления из конфигурации, прав не даёт.
     */
    rightsOf(userGuid: string | null): Effect.Effect<UserRights, DatabaseError, Database> {
        return Effect.gen(function* (this: RightsGuardPlatform) {
            const names = userGuid === null ? [] : yield* userRoleNames(userGuid);
            const database = yield* Database;
            const settings = yield* database.all<AccessSetting>({ sql: 'SELECT * FROM platform_access_settings', parameters: [] });
            return this.rightsFromRoles(names, settings, userGuid);
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

/** Храним только пользовательские настройки известных узлов, без серверных расширений. */
export interface AccessSetting extends Record<string, unknown> {
    readonly subjectKind: 'role' | 'user'; readonly subject: string;
    readonly kind: AccessTarget['kind']; readonly name: string; readonly path: string;
    readonly level: import('./access-schema.js').AccessLevel;
}
const settingEntry = (setting: AccessSetting) => ({ target: { kind: setting.kind, name: setting.name }, path: setting.path, level: setting.level });
