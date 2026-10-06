/**
 * Роли: именованные наборы прав, которые назначаются пользователям.
 *
 * Роли — часть конфигурации, как и объекты: платформа не знает, какие роли нужны конкретному
 * магазину. Они описываются билдерами в `src/configuration/roles.ts` и собираются при запуске.
 * В базе хранится только связь пользователя с именем роли, а состав прав роли берётся из
 * конфигурации. Поэтому изменение роли действует на всех её пользователей после перезапуска
 * и не требует переноса данных.
 */
import { Effect } from 'effect';
import { MetadataError, type MetadataProblem } from '../metadata/metadata.errors.js';
import type { Right } from './rights.js';

/** Всё, что накопила цепочка вызовов билдера роли. */
interface RoleState {
    readonly name: string;
    readonly title: string | null;
    readonly all: boolean;
    readonly rights: ReadonlyArray<Right>;
}

/** Билдер роли; его создаёт `role(name)`. Неизменяем, как и билдеры объектов: каждый вызов возвращает новый билдер. */
export class RoleBuilder {
    readonly '~state': RoleState;

    constructor(state: RoleState) {
        this['~state'] = state;
    }

    /** Название роли в интерфейсе. Если оно не задано, используется имя. */
    title(title: string): RoleBuilder {
        return new RoleBuilder({ ...this['~state'], title });
    }

    /** Добавляет роли права. Права берутся из объекта `Rights`, а не записываются строками. */
    grant(...rights: ReadonlyArray<Right>): RoleBuilder {
        return new RoleBuilder({ ...this['~state'], rights: [...this['~state'].rights, ...rights] });
    }

    /**
     * Даёт роли все права, в том числе права объектов и действий, которые появятся в конфигурации
     * позже. Перечислять их через `grant` пришлось бы при каждом добавлении объекта, а забытое
     * право лишило бы администратора доступа к новому объекту.
     */
    grantAll(): RoleBuilder {
        return new RoleBuilder({ ...this['~state'], all: true });
    }
}

/** Роль с именем `name`. По имени роль хранится в базе у пользователя, поэтому менять его после назначения нельзя. */
export function role(name: string): RoleBuilder {
    return new RoleBuilder({ name, title: null, all: false, rights: [] });
}

/** Готовое описание роли, с которым работает проверка прав. */
export interface RoleDescription {
    readonly name: string;
    readonly title: string;
    /** Роль даёт все права; `rights` при этом не проверяется. */
    readonly all: boolean;
    /** Ключи прав роли. */
    readonly rights: ReadonlySet<string>;
}

/** lowerCamelCase латиницей, как имена объектов: имя роли указывают в настройках и параметрах запуска. */
export const roleNamePattern = /^[a-z][A-Za-z0-9]*$/;

/**
 * Проверяет роли и собирает их описания. Завершается `MetadataError` со всеми найденными
 * проблемами: неверным именем роли или повтором имени. Повтор нельзя разрешить молча:
 * пользователь с такой ролью получил бы права только одного из двух описаний.
 */
export function commitRoles(builders: ReadonlyArray<RoleBuilder>): Effect.Effect<ReadonlyArray<RoleDescription>, MetadataError> {
    return Effect.suspend(() => {
        const problems: Array<MetadataProblem> = [];
        const names = new Set<string>();
        const roles = builders.map((builder): RoleDescription => {
            const state = builder['~state'];
            const object = `роль ${state.name}`;
            if (!roleNamePattern.test(state.name)) {
                problems.push({ object, location: null, message: 'имя роли должно быть в lowerCamelCase латиницей: начинаться со строчной буквы и содержать только буквы и цифры' });
            }
            if (names.has(state.name)) problems.push({ object, location: null, message: 'имя роли повторяется' });
            names.add(state.name);
            return Object.freeze({
                name: state.name,
                title: state.title ?? state.name,
                all: state.all,
                rights: new Set(state.rights.map((right) => right.key)),
            });
        });
        return problems.length > 0 ? Effect.fail(new MetadataError({ problems })) : Effect.succeed(roles);
    });
}
