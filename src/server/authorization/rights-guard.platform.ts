import { platformObjectBuilders } from '../metadata/platform-objects.js';
import { configurationModules, pageModules } from '../../configuration/configuration.generated.js';
import { isObjectBuilder } from '../metadata/builders.js';
import { isPageBuilder } from '../ui/pages.js';
import { resolveAccess, type AccessDefinition, type AccessTarget, type AccessDecision, type AccessEntry } from './access-schema.js';
import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { roles as configurationRoles } from '../../configuration/roles.js';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { RightsDeniedError } from './authorization.errors.js';
import { describePlatformRights, pageOpenRight, rightAccessPath, type Right } from './rights.js';
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
    private readonly objects = [...platformObjectBuilders, ...configurationModules.flatMap(module => Object.values(module.exports).filter(isObjectBuilder))];
    private readonly pages = pageModules.flatMap(module => Object.values(module.exports).filter(isPageBuilder));
    private readonly platform = describePlatformRights();
    private readonly callPaths = new Map<string, { target: AccessTarget; path: string }>([
        ...this.pages.map(page => [pageOpenRight(page.name).key, { target: page, path: 'actions.open' }] as const),
        ...this.platform.flatMap(section => section.operations.map(({ right, operation }) => [right.key, { target: section, path: `actions.${operation}` }] as const)),
    ]);
    private readonly fullAccess: readonly AccessEntry[] = [...this.objects, ...this.pages, ...this.platform].map(({ kind, name }) => ({
        target: { kind, name }, path: '', level: 'full',
    }));

    /** Проверяет объявления ролей до обработки запросов. */
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
        const defaults = this.objects.map(object => object['~state'].access);
        const definitions: AccessDefinition[] = [...defaults, ...roles.map(role => {
            // Полный доступ на корнях сочетается с уровнями других ролей и с точечными исключениями.
            const entries = role.all ? [...this.fullAccess, ...role.access.entries] : role.access.entries;
            // Фиксированная роль всегда берёт права из конфигурации, в том числе на старой базе.
            const overrides = role.readOnly ? [] : settings.filter(setting => setting.subjectKind === 'role' && setting.subject === role.name);
            return { groups: role.access.groups, entries: entries.filter(entry => !overrides.some(setting => setting.kind === entry.target.kind && setting.name === entry.target.name && setting.path === entry.path)).concat(overrides.map(settingEntry)) };
        }), { groups: [], entries: settings.filter(setting => setting.subjectKind === 'user' && setting.subject === userGuid).map(settingEntry) }];
        const full = roles.some(role => role.all);
        const decision = (target: AccessTarget, path: string) => resolveAccess(definitions, target, path);
        /** Все вызовы проверяются по дереву; чтение и запись проверяют доступные поля объекта. */
        const allows = (right: Right) => {
            const call = this.callPaths.get(right.key);
            if (call !== undefined) return decision(call.target, call.path).level === 'allow';
            const [kind, name, ...segments] = right.key.split('.');
            const object = this.objects.find(object => object.kind === kind && object.name === name);
            if (object === undefined) return false;
            if (segments[0] === 'read' || segments[0] === 'write') {
                const state = object.withStandardFields()['~state'];
                const names = [...state.fields.map(field => field.name), ...state.tableParts.flatMap(part => part.fields.map(field => `${part.name}.${field.name}`))];
                return names.some(name => { const level = decision(object, `fields.${name}`).level; return segments[0] === 'write' ? level === 'edit' : level === 'edit' || level === 'read'; });
            }
            return decision(object, rightAccessPath(segments)).level === 'allow';
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
