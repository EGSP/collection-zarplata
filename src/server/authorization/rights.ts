/**
 * Права доступа, выведенные из метаданных.
 *
 * Право не объявляется вручную: его даёт сам объект конфигурации. У каждого объекта есть
 * стандартные права его вида, а каждое собственное действие получает отдельное право. Поэтому
 * новый объект или новое действие сразу защищены, и забыть объявить право невозможно.
 * Так же страница конфигурации даёт право её открыть.
 *
 * Соответствие «действие → право» задано здесь один раз. Им пользуются и проверка прав
 * в диспетчере, и построение описаний форм: действие, которое форма показала пользователю,
 * диспетчер от него же примет.
 *
 * Конфигурация указывает права переменными из объекта `Rights`, а не строками. Объект строится
 * из билдеров, и его тип выводится из их типов: опечатка в имени объекта, права или действия —
 * ошибка компиляции. Сравниваются права по ключу, поэтому право из `Rights` и право, которое
 * диспетчер вычислил по описанию объекта, равны без общего реестра.
 */
import { isObjectBuilder, type BuildersOf, type ExportsOf, type ObjectBuilder } from '../metadata/builders.js';
import type { ObjectDescription, ObjectKind } from '../metadata/descriptions.js';
import { isPageBuilder, pageKind, type PageBuilder } from '../ui/pages.js';

/**
 * Право доступа. Ключ однозначно определяет право: `catalog.employees.write`,
 * `document.shift.post`, `catalog.employees.actions.dismiss`, `platform.journal.read`.
 */
export interface Right {
    readonly key: string;
}

/**
 * Стандартные права видов объектов и действия единого эндпоинта, которые каждое право разрешает.
 * Пометка удаления входит в право записи: это изменение записи. Проведение и его отмена
 * выделены в отдельное право, чтобы запись документа можно было разрешить без проведения.
 */
const standardPermissions = {
    informationRegister: {
        read: ['list', 'get'],
        write: ['save', 'delete'],
    },
    catalog: {
        read: ['list', 'get'],
        write: ['save', 'markDeleted', 'unmarkDeleted', 'import'],
    },
    document: {
        read: ['list', 'get'],
        write: ['save', 'markDeleted', 'unmarkDeleted'],
        post: ['post', 'unpost'],
    },
    register: {
        read: ['list'],
    },
} as const satisfies { readonly [Kind in ObjectKind]: { readonly [permission: string]: ReadonlyArray<string> } };

/** Действия единого эндпоинта по видам объектов: все действия, перечисленные в стандартных правах вида. */
type StandardActions = {
    readonly [Kind in ObjectKind]: (typeof standardPermissions)[Kind][keyof (typeof standardPermissions)[Kind]] extends ReadonlyArray<infer Action> ? Action : never;
};

/**
 * Имя стандартного действия объекта вида `Kind`. По этому типу клиент проверяет имя действия
 * при компиляции, поэтому перечень действий задан один раз, вместе с правами.
 */
export type StandardAction<Kind extends ObjectKind> = StandardActions[Kind];

/**
 * Часть ключа, которая отделяет права собственных действий от стандартных прав объекта.
 * Без неё действие с именем `read` или `write` получило бы ключ стандартного права.
 */
const actionsSegment = 'actions';

function right(...segments: ReadonlyArray<string>): Right {
    return Object.freeze({ key: segments.join('.') });
}

/**
 * Права платформы, которые не относятся к объектам конфигурации. Журнал показывает изменения
 * всех объектов, поэтому его чтение — отдельное право, а не следствие права чтения объекта.
 */
export const platformRights = Object.freeze({
    journal: Object.freeze({ read: right('platform', 'journal', 'read') }),
});

/** Стандартные права объекта вида `Kind`. */
type StandardRights<Kind extends ObjectKind> = { readonly [Permission in keyof (typeof standardPermissions)[Kind]]: Right };

/** Права одного объекта: стандартные права вида и права собственных действий в `actions`. */
export type ObjectRights<Kind extends ObjectKind, Actions extends string> = StandardRights<Kind> & {
    readonly actions: { readonly [Action in Actions]: Right };
};

/**
 * Права страницы. Право `open` управляет только видимостью пункта меню и адреса страницы:
 * доступ к данным, которые страница показывает, проверяется по правам объектов.
 */
export interface PageRights {
    readonly open: Right;
}

/** Права конфигурации: вид объекта → имя объекта → права, страницы по именам и отдельно права платформы. */
export type ConfigurationRights<Builders extends ObjectBuilder, Pages extends PageBuilder = never> = {
    readonly [Kind in ObjectKind]: {
        readonly [Builder in Extract<Builders, { readonly kind: Kind }> as Builder['name']]: ObjectRights<Kind, Builder['~actions']>;
    };
} & {
    readonly page: { readonly [Page in Pages as Page['name']]: PageRights };
    readonly platform: typeof platformRights;
};

/** Билдеры страниц среди экспорта модулей объявлений страниц. */
type PagesOf<Modules extends ReadonlyArray<object>> = Extract<ExportsOf<Modules[number]>, PageBuilder>;

/**
 * Строит объект `Rights` из модулей объектов конфигурации и модулей объявлений страниц.
 * Вызывается в сгенерированном реестре `configuration.generated.ts` со списком всех модулей,
 * поэтому права появляются вместе с файлом объекта или страницы. Значения экспорта, которые
 * не являются билдерами, пропускаются: соглашение о файлах конфигурации проверяется при запуске
 * сервера, и там о нарушении сообщается понятнее.
 */
export function defineRights<const Modules extends ReadonlyArray<object>, const PageModules extends ReadonlyArray<object> = []>(
    modules: Modules,
    pageModules?: PageModules,
): ConfigurationRights<BuildersOf<Modules>, PagesOf<PageModules>> {
    const rights: { [Kind in ObjectKind]: { [name: string]: object } } = { catalog: {}, document: {}, register: {}, informationRegister: {} };
    for (const module of modules) {
        for (const value of Object.values(module)) {
            if (!isObjectBuilder(value)) continue;
            const standard = Object.keys(standardPermissions[value.kind]).map((permission) => [permission, right(value.kind, value.name, permission)]);
            const actions = value['~state'].actions.map((action) => [action.name, right(value.kind, value.name, actionsSegment, action.name)]);
            rights[value.kind][value.name] = Object.freeze({ ...Object.fromEntries(standard), actions: Object.freeze(Object.fromEntries(actions)) });
        }
    }
    const pages: { [name: string]: PageRights } = {};
    for (const module of pageModules ?? []) {
        for (const value of Object.values(module)) {
            if (isPageBuilder(value)) pages[value.name] = Object.freeze({ open: pageOpenRight(value.name) });
        }
    }
    // Точный тип существует только на уровне типов: он выведен из типов билдеров, а объект собран по их состоянию.
    return Object.freeze({
        catalog: Object.freeze(rights.catalog),
        document: Object.freeze(rights.document),
        register: Object.freeze(rights.register),
        informationRegister: Object.freeze(rights.informationRegister),
        page: Object.freeze(pages),
        platform: platformRights,
    }) as unknown as ConfigurationRights<BuildersOf<Modules>, PagesOf<PageModules>>;
}

/** Право открыть страницу конфигурации. Без него страницы нет ни в меню, ни в ответе `GET /api/metadata`. */
export function pageOpenRight(name: string): Right {
    return right(pageKind, name, 'open');
}

/**
 * Право, которое нужно для действия единого эндпоинта над объектом. Возвращает `undefined`,
 * если такого действия у объекта нет: тогда диспетчер ответит, что действие не найдено,
 * и проверять нечего.
 */
export function requiredRight(description: Pick<ObjectDescription, 'kind' | 'name' | 'actions'>, action: string): Right | undefined {
    const permissions: { readonly [permission: string]: ReadonlyArray<string> } = standardPermissions[description.kind];
    for (const [permission, actions] of Object.entries(permissions)) {
        if (actions.includes(action)) return right(description.kind, description.name, permission);
    }
    if (description.actions.some((candidate) => candidate.name === action)) {
        return right(description.kind, description.name, actionsSegment, action);
    }
    return undefined;
}

/** Право чтения объекта. Без него объект пользователю недоступен: его нет и в описаниях для клиента. */
export function readRight(description: Pick<ObjectDescription, 'kind' | 'name'>): Right {
    return right(description.kind, description.name, 'read');
}
