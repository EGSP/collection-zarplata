import { emptyAccess, type AccessDefinition } from './access-schema.js';
/**
 * Роли: именованные наборы прав, которые назначаются пользователям.
 *
 * Роли — часть конфигурации, как и объекты: платформа не знает, какие роли нужны конкретному
 * магазину. Они описываются билдерами в `src/configuration/roles.ts` и собираются при запуске.
 * База хранит назначения и переопределения редактируемых ролей. Роли только для чтения
 * при каждом запуске получают права из конфигурации.
 */
import { Effect } from 'effect';
import { MetadataError, type MetadataProblem } from '../metadata/metadata.errors.js';

/** Всё, что накопила цепочка вызовов билдера роли. */
interface RoleState {
    readonly access: AccessDefinition;
    readonly name: string;
    readonly title: string | null;
    readonly all: boolean;
    readonly readOnly: boolean;
}

/** Билдер роли; его создаёт `role(name)`. Неизменяем, как и билдеры объектов: каждый вызов возвращает новый билдер. */
export class RoleBuilder {
    readonly '~state': RoleState;

    /** Сохраняет состояние отдельного шага объявления роли. */
    constructor(state: RoleState) {
        this['~state'] = state;
    }

    /** Название роли в интерфейсе. Если оно не задано, используется имя. */
    title(title: string): RoleBuilder {
        return new RoleBuilder({ ...this['~state'], title });
    }

    /** Фиксирует права роли в конфигурации, сохраняя возможность назначать её пользователям. */
    readOnly(): RoleBuilder {
        return new RoleBuilder({ ...this['~state'], readOnly: true });
    }

    /** Добавляет настройки доступа к объектам, страницам и операциям платформы. */
    access(schema: AccessDefinition): RoleBuilder {
        return new RoleBuilder({ ...this['~state'], access: { entries: [...this['~state'].access.entries, ...schema.entries], groups: [...this['~state'].access.groups, ...schema.groups] } });
    }

    /**
     * Даёт полный доступ на корнях схемы, включая объекты, страницы и операции платформы,
     * которые появятся позже. Более точные правила дочерних узлов продолжают действовать.
     */
    grantAll(): RoleBuilder {
        return new RoleBuilder({ ...this['~state'], all: true });
    }
}

/** Роль с именем `name`. По имени роль хранится в базе у пользователя, поэтому менять его после назначения нельзя. */
export function role(name: string): RoleBuilder {
    return new RoleBuilder({ name, title: null, all: false, readOnly: false, access: emptyAccess });
}

/** Готовое описание роли, с которым работает проверка прав. */
export interface RoleDescription {
    readonly access: AccessDefinition;
    readonly name: string;
    readonly title: string;
    /** Исходный полный доступ; явные исключения дерева продолжают действовать. */
    readonly all: boolean;
    /** При этом признаке настройки роли из базы не участвуют в проверке. */
    readonly readOnly: boolean;
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
                access: state.access,
                name: state.name,
                title: state.title ?? state.name,
                all: state.all,
                readOnly: state.readOnly,
            });
        });
        return problems.length > 0 ? Effect.fail(new MetadataError({ problems })) : Effect.succeed(roles);
    });
}
