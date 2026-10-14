import { Injectable, type DynamicModule, type ForwardReference, type Type } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants.js';
import { ApplicationConfig, ModuleRef, ModulesContainer } from '@nestjs/core';
import type { InstanceWrapper } from '@nestjs/core/injector/instance-wrapper.js';
import type { Module } from '@nestjs/core/injector/module.js';
import type {
    ClassKind,
    ModuleKind,
    ModulesGraph,
    ModulesGraphClass,
    ModulesGraphInjection,
    ModulesGraphLink,
    ModulesGraphModule,
    ProviderShape,
} from '../../common/modules-graph.js';

/** Запись в `imports`: класс модуля, динамический модуль, его обещание или `forwardRef()`. */
type ImportEntry = Type | DynamicModule | Promise<DynamicModule> | ForwardReference;

/** Как модуль объявил импорт другого модуля; ключ — класс импортированного модуля. */
interface DeclaredImport {
    readonly forwardReference: boolean;
    readonly dynamicImport: boolean;
}

/** Служебный модуль Nest: его создаёт ядро, а не приложение. */
const coreModuleName = 'InternalCoreModule';

/**
 * Провайдеры, которые Nest добавляет в каждый модуль сам. В графе они не нужны:
 * без фильтра у каждого модуля появились бы одинаковые `ModuleRef` и `ApplicationConfig`.
 */
const implicitProviderTokens = new Set<unknown>([ModuleRef, ApplicationConfig]);

/**
 * Строит граф модулей по контейнеру запущенного приложения. Контейнер уже содержит модули,
 * связи импорта и разрешённые зависимости каждого класса, поэтому второй экземпляр приложения
 * и режим `snapshot` не нужны.
 *
 * Nest после сканирования добавляет глобальные модули в импорты каждого модуля. Чтобы отличить
 * явный импорт от доступа через `@Global()`, сервис сверяет фактические импорты с записанными
 * в `@Module({ imports })`. Связь через глобальный модуль попадает в граф, только если модуль
 * действительно внедряет что-то из него: иначе каждый модуль был бы связан с каждым глобальным.
 *
 * Сервис использует внутренние классы Nest `Module` и `InstanceWrapper`. При обновлении Nest
 * их поля нужно сверить: публичного API для разрешённых зависимостей у фреймворка нет.
 */
@Injectable()
export class ModulesGraphService {
    /** Граф не меняется после запуска приложения, поэтому строится один раз при первом запросе. */
    private graph: Promise<ModulesGraph> | undefined;

    constructor(private readonly modulesContainer: ModulesContainer) {}

    getGraph(): Promise<ModulesGraph> {
        this.graph ??= this.build();
        return this.graph;
    }

    private async build(): Promise<ModulesGraph> {
        const containerModules = [...this.modulesContainer.values()];
        const declaredImports = await this.collectDeclaredImports(containerModules);
        const dynamicModules = new Set<Function>();
        for (const imports of declaredImports.values()) {
            for (const [moduleClass, declaration] of imports) if (declaration.dynamicImport) dynamicModules.add(moduleClass);
        }

        const modules = containerModules.map((moduleReference): ModulesGraphModule => ({
            id: moduleReference.id,
            name: moduleReference.name,
            kind: this.moduleKind(moduleReference, dynamicModules),
            classes: this.moduleClasses(moduleReference).map(({ wrapper, kind }) => this.describeClass(moduleReference, wrapper, kind)),
            reexportedModules: [...moduleReference.exports]
                .filter((token) => containerModules.some((module) => module.metatype === token))
                .map((token) => (token as Function).name),
        }));

        const injections = containerModules.flatMap((moduleReference) =>
            this.moduleClasses(moduleReference).flatMap(({ wrapper }) => this.describeInjections(moduleReference, wrapper)));

        return { modules, links: this.collectLinks(containerModules, declaredImports, injections), injections };
    }

    /**
     * Записанные импорты каждого модуля. Для динамического модуля к импортам из декоратора
     * добавляются импорты из объекта, который вернул его `forRoot()` или `register()`.
     */
    private async collectDeclaredImports(modules: ReadonlyArray<Module>): Promise<Map<Function, Map<Function, DeclaredImport>>> {
        const result = new Map<Function, Map<Function, DeclaredImport>>();
        // Один список импортов разбирается однажды: так циклические динамические импорты не зациклят обход.
        const processedLists = new Set<ReadonlyArray<ImportEntry>>();

        const declare = async (moduleClass: Function, entries: ReadonlyArray<ImportEntry> | undefined): Promise<void> => {
            const imports = result.get(moduleClass) ?? new Map<Function, DeclaredImport>();
            result.set(moduleClass, imports);
            if (entries === undefined || processedLists.has(entries)) return;
            processedLists.add(entries);
            for (const entry of entries) {
                const resolved = await this.resolveImportEntry(entry);
                if (resolved === undefined) continue;
                imports.set(resolved.moduleClass, { forwardReference: resolved.forwardReference, dynamicImport: resolved.dynamic !== undefined });
                // Импорты динамического модуля записаны в объекте, который вернул его метод настройки.
                if (resolved.dynamic !== undefined) await declare(resolved.moduleClass, resolved.dynamic.imports as ImportEntry[] | undefined);
            }
        };
        for (const module of modules) {
            await declare(module.metatype, Reflect.getMetadata(MODULE_METADATA.IMPORTS, module.metatype) as ImportEntry[] | undefined);
        }
        return result;
    }

    /** Класс модуля из записи `imports` и признаки того, как она записана. */
    private async resolveImportEntry(entry: ImportEntry): Promise<{ moduleClass: Function; forwardReference: boolean; dynamic?: DynamicModule } | undefined> {
        if (typeof entry === 'function') return { moduleClass: entry, forwardReference: false };
        if (entry instanceof Promise) {
            const dynamic = await entry;
            return { moduleClass: dynamic.module, forwardReference: false, dynamic };
        }
        if ('forwardRef' in entry) {
            const target = await this.resolveImportEntry(entry.forwardRef() as ImportEntry);
            return target === undefined ? undefined : { ...target, forwardReference: true };
        }
        if ('module' in entry) return { moduleClass: entry.module, forwardReference: false, dynamic: entry };
        return undefined;
    }

    private moduleKind(module: Module, dynamicModules: ReadonlySet<Function>): ModuleKind {
        if (module.name === coreModuleName) return 'core';
        if (module.isGlobal) return 'global';
        if (dynamicModules.has(module.metatype)) return 'dynamic';
        return 'regular';
    }

    /**
     * Классы модуля, которые стоит показать: провайдеры, контроллеры, улучшители и сам класс модуля,
     * если он получает зависимости. Неявные провайдеры Nest и псевдонимы улучшителей пропускаются.
     */
    private moduleClasses(module: Module): ReadonlyArray<{ wrapper: InstanceWrapper; kind: ClassKind }> {
        const classes: Array<{ wrapper: InstanceWrapper; kind: ClassKind }> = [];
        for (const [token, wrapper] of module.providers) {
            if (implicitProviderTokens.has(token)) continue;
            if (token === module.metatype) {
                // Класс модуля Nest регистрирует провайдером всегда; без зависимостей он ничего не добавляет к графу.
                if (wrapper.getCtorMetadata()?.length || wrapper.getPropertiesMetadata()?.length) classes.push({ wrapper, kind: 'module' });
                continue;
            }
            classes.push({ wrapper, kind: 'provider' });
        }
        for (const wrapper of module.controllers.values()) classes.push({ wrapper, kind: 'controller' });
        for (const wrapper of module.injectables.values()) classes.push({ wrapper, kind: 'enhancer' });
        return classes;
    }

    private describeClass(module: Module, wrapper: InstanceWrapper, kind: ClassKind): ModulesGraphClass {
        return {
            name: tokenName(wrapper.token, wrapper.name),
            kind,
            shape: providerShape(wrapper),
            exported: module.exports.has(wrapper.token),
            ...(wrapper.subtype === undefined ? {} : { enhancerType: wrapper.subtype }),
        };
    }

    /** Внедрения класса по зависимостям, которые Nest разрешил при создании экземпляра. */
    private describeInjections(module: Module, wrapper: InstanceWrapper): ReadonlyArray<ModulesGraphInjection> {
        const source = { sourceModuleId: module.id, sourceClass: tokenName(wrapper.token, wrapper.name) };
        const target = (dependency: InstanceWrapper) => ({
            // Зависимость без модуля-владельца относится к ядру Nest, например HttpAdapterHost.
            targetModuleId: dependency.host?.id ?? this.coreModuleId(),
            targetClass: tokenName(dependency.token, dependency.name),
        });
        const constructorInjections = (wrapper.getCtorMetadata() ?? []).map((dependency, index) => ({
            ...source, ...target(dependency), place: 'constructor' as const, position: String(index),
        }));
        const propertyInjections = (wrapper.getPropertiesMetadata() ?? []).map(({ key, wrapper: dependency }) => ({
            ...source, ...target(dependency), place: 'property' as const, position: String(key),
        }));
        return [...constructorInjections, ...propertyInjections];
    }

    private coreModuleId(): string {
        return [...this.modulesContainer.values()].find((module) => module.name === coreModuleName)?.id ?? coreModuleName;
    }

    /**
     * Связи модулей. Явный импорт показывается всегда, даже без внедрений: модуль мог импортировать
     * другой ради его экспорта или порядка инициализации. Доступ через `@Global()` показывается
     * только при внедрении из глобального модуля. Внедрение, которому не нашлось ни импорта,
     * ни глобального доступа, возможно только через реэкспорт и показывается связью `reexport`.
     */
    private collectLinks(
        modules: ReadonlyArray<Module>,
        declaredImports: ReadonlyMap<Function, ReadonlyMap<Function, DeclaredImport>>,
        injections: ReadonlyArray<ModulesGraphInjection>,
    ): ReadonlyArray<ModulesGraphLink> {
        const usedTargets = new Set(injections.filter((injection) => injection.sourceModuleId !== injection.targetModuleId)
            .map((injection) => `${injection.sourceModuleId}→${injection.targetModuleId}`));
        const links: ModulesGraphLink[] = [];
        for (const module of modules) {
            const declared = declaredImports.get(module.metatype);
            for (const imported of module.imports) {
                const declaration = declared?.get(imported.metatype);
                if (declaration !== undefined) {
                    links.push({ sourceModuleId: module.id, targetModuleId: imported.id, declaration: 'import', ...declaration });
                } else if (usedTargets.has(`${module.id}→${imported.id}`)) {
                    links.push({ sourceModuleId: module.id, targetModuleId: imported.id, declaration: 'global', forwardReference: false, dynamicImport: false });
                }
            }
        }
        const linked = new Set(links.map((link) => `${link.sourceModuleId}→${link.targetModuleId}`));
        for (const pair of usedTargets) {
            if (linked.has(pair)) continue;
            const [sourceModuleId = '', targetModuleId = ''] = pair.split('→');
            links.push({ sourceModuleId, targetModuleId, declaration: 'reexport', forwardReference: false, dynamicImport: false });
        }
        return links;
    }
}

/** Имя токена для показа: имя класса, описание символа или строка. */
function tokenName(token: unknown, fallback: unknown): string {
    if (typeof token === 'function') return token.name;
    if (typeof token === 'symbol') return token.description ?? token.toString();
    if (typeof token === 'string') return token;
    return String(fallback);
}

/** Способ объявления провайдера по признакам обёртки Nest. */
function providerShape(wrapper: InstanceWrapper): ProviderShape {
    if (wrapper.isAlias) return 'alias';
    if (wrapper.isFactory) return 'factory';
    if (wrapper.isNotMetatype) return 'value';
    return 'class';
}
