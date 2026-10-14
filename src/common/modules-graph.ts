/**
 * Граф модулей Nest: ответ сервера для страницы `/modules-graph`. Сервер строит его по контейнеру
 * запущенного приложения, клиент раскладывает и рисует. Формат общий, поэтому файл содержит только типы.
 */

/**
 * Вид модуля:
 * - `regular` — обычный модуль, доступный только импортировавшим его модулям;
 * - `global` — модуль с `@Global()`: Nest делает его экспорт доступным всем модулям без импорта;
 * - `dynamic` — модуль, подключённый как динамический (`forRoot()`, `register()` и подобные);
 * - `core` — служебный модуль Nest с `HttpAdapterHost`, `ModulesContainer` и другими средствами ядра.
 */
export type ModuleKind = 'regular' | 'global' | 'dynamic' | 'core';

/**
 * Вид класса внутри модуля:
 * - `module` — сам класс модуля, если он получает зависимости через конструктор;
 * - `provider`, `controller` — провайдер и контроллер из `@Module()`;
 * - `enhancer` — guard, interceptor, pipe или filter, подключённый декоратором вроде `@UseGuards()`.
 */
export type ClassKind = 'module' | 'provider' | 'controller' | 'enhancer';

/**
 * Способ объявления провайдера: класс, `useValue`, `useFactory` или `useExisting`.
 * У контроллеров и классов модулей способ всегда `class`.
 */
export type ProviderShape = 'class' | 'value' | 'factory' | 'alias';

export interface ModulesGraphClass {
    readonly name: string;
    readonly kind: ClassKind;
    readonly shape: ProviderShape;
    /** Провайдер входит в `exports` модуля и доступен импортирующим модулям. */
    readonly exported: boolean;
    /** Вид улучшителя Nest для `enhancer`: `guard`, `interceptor`, `pipe` или `filter`. */
    readonly enhancerType?: string;
}

export interface ModulesGraphModule {
    /** Идентификатор модуля в контейнере Nest; различает экземпляры одного динамического модуля. */
    readonly id: string;
    readonly name: string;
    readonly kind: ModuleKind;
    readonly classes: ReadonlyArray<ModulesGraphClass>;
    /** Модули, которые этот модуль экспортирует дальше вместе с их экспортом. */
    readonly reexportedModules: ReadonlyArray<string>;
}

/**
 * Способ, которым модуль получил доступ к другому модулю:
 * - `import` — модуль указан в `imports` декоратора `@Module()` или динамического модуля;
 * - `global` — доступ дан через `@Global()` без импорта; такая связь попадает в граф,
 *   только если модуль действительно внедряет что-то из глобального модуля;
 * - `reexport` — модуль внедряет провайдер модуля, который импортированный модуль экспортирует дальше
 *   (`exports: [OtherModule]`); прямого импорта между ними нет.
 */
export type LinkDeclaration = 'import' | 'global' | 'reexport';

/** Способ внедрения: параметр конструктора или свойство с `@Inject()`. */
export type InjectionPlace = 'constructor' | 'property';

/** Одно внедрение зависимости: класс `sourceClass` получает `targetClass`. */
export interface ModulesGraphInjection {
    readonly sourceModuleId: string;
    readonly sourceClass: string;
    readonly targetModuleId: string;
    readonly targetClass: string;
    readonly place: InjectionPlace;
    /** Номер параметра конструктора или имя свойства. */
    readonly position: string;
}

/** Связь модулей: `sourceModuleId` зависит от `targetModuleId`. */
export interface ModulesGraphLink {
    readonly sourceModuleId: string;
    readonly targetModuleId: string;
    readonly declaration: LinkDeclaration;
    /** Импорт записан через `forwardRef()`: так Nest разрешает циклическую зависимость модулей. */
    readonly forwardReference: boolean;
    /** Импорт записан динамическим модулем, а не классом. */
    readonly dynamicImport: boolean;
}

export interface ModulesGraph {
    readonly modules: ReadonlyArray<ModulesGraphModule>;
    readonly links: ReadonlyArray<ModulesGraphLink>;
    /** Все внедрения, включая внедрения внутри одного модуля. */
    readonly injections: ReadonlyArray<ModulesGraphInjection>;
}
