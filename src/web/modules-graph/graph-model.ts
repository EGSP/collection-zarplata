/**
 * Модель отображения графа: какие модули и связи видны при выбранных настройках, к какой категории
 * относится каждая связь и сколько у модуля зависимых. Ответ сервера остаётся неизменным, модель
 * пересчитывается при переключении настроек.
 */
import type { ModuleKind, ModulesGraph, ModulesGraphInjection, ModulesGraphLink, ModulesGraphModule } from '../../common/modules-graph';

export interface ViewOptions {
    /** Показывать служебный модуль ядра Nest и связи с ним. */
    readonly showCore: boolean;
    /** Показывать связи через `@Global()`; явные импорты и реэкспорт видны всегда. */
    readonly showGlobalLinks: boolean;
}

/**
 * Категория связи на холсте и в легенде. В отличие от способа объявления на сервере, категория
 * выделяет случаи, которые разработчику нужно замечать отдельно:
 * - `unused` — явный импорт, через который не идёт ни одно внедрение; кандидат на удаление;
 * - `forward-reference` — импорт через `forwardRef()`, то есть цикл между модулями;
 * - `root` — импорт в корневом модуле. Корневой модуль собирает приложение: импорт регистрирует
 *   модуль в Nest, и внедрения через него не нужны. Без отдельной категории все такие импорты
 *   выглядели бы неиспользуемыми и заслоняли бы действительно лишние.
 */
export type LinkCategory = 'import' | 'unused' | 'root' | 'global' | 'reexport' | 'forward-reference';

export const linkCategories: ReadonlyArray<LinkCategory> = ['import', 'unused', 'root', 'global', 'reexport', 'forward-reference'];

export interface LinkView {
    /** Ключ связи для холста: пара модулей однозначна, потому что сервер не повторяет связи. */
    readonly id: string;
    readonly link: ModulesGraphLink;
    readonly category: LinkCategory;
    /** Внедрения из модуля-источника в модуль-цель, которые идут через эту связь. */
    readonly injections: ReadonlyArray<ModulesGraphInjection>;
}

export interface ModuleView {
    readonly module: ModulesGraphModule;
    /** Модули, которые зависят от этого: импортируют его или внедряют из него. */
    readonly dependents: ReadonlyArray<string>;
    /** Модули, от которых зависит этот. */
    readonly dependencies: ReadonlyArray<string>;
    /** Внедрения между классами внутри модуля. */
    readonly internalInjections: ReadonlyArray<ModulesGraphInjection>;
}

export interface GraphView {
    readonly modules: ReadonlyMap<string, ModuleView>;
    readonly links: ReadonlyArray<LinkView>;
    /** Наибольшее число зависимых: от него отсчитываются размер и насыщенность заливки узлов. */
    readonly maxDependents: number;
}

export function linkId(link: Pick<ModulesGraphLink, 'sourceModuleId' | 'targetModuleId'>): string {
    return `${link.sourceModuleId}→${link.targetModuleId}`;
}

function linkCategory(link: ModulesGraphLink, injections: ReadonlyArray<ModulesGraphInjection>, rootIds: ReadonlySet<string>): LinkCategory {
    if (link.forwardReference) return 'forward-reference';
    if (link.declaration === 'global') return 'global';
    if (link.declaration === 'reexport') return 'reexport';
    if (injections.length === 0 && rootIds.has(link.sourceModuleId)) return 'root';
    return injections.length === 0 ? 'unused' : 'import';
}

export function buildGraphView(graph: ModulesGraph, options: ViewOptions): GraphView {
    const visibleModules = graph.modules.filter((module) => options.showCore || module.kind !== 'core');
    const visibleIds = new Set(visibleModules.map((module) => module.id));
    // Корневой модуль никто не импортирует: Nest начинает с него обход приложения.
    const targetIds = new Set(graph.links.map((link) => link.targetModuleId));
    const rootIds = new Set(graph.modules.filter((module) => module.kind !== 'core' && !targetIds.has(module.id)).map((module) => module.id));

    const injectionsByLink = new Map<string, ModulesGraphInjection[]>();
    for (const injection of graph.injections) {
        const key = linkId(injection);
        injectionsByLink.set(key, [...(injectionsByLink.get(key) ?? []), injection]);
    }

    const links = graph.links
        .filter((link) => visibleIds.has(link.sourceModuleId) && visibleIds.has(link.targetModuleId))
        .filter((link) => options.showGlobalLinks || link.declaration !== 'global')
        .map((link): LinkView => {
            const injections = injectionsByLink.get(linkId(link)) ?? [];
            return { id: linkId(link), link, category: linkCategory(link, injections, rootIds), injections };
        });

    const modules = new Map<string, ModuleView>();
    for (const module of visibleModules) {
        modules.set(module.id, {
            module,
            dependents: links.filter((view) => view.link.targetModuleId === module.id).map((view) => view.link.sourceModuleId),
            dependencies: links.filter((view) => view.link.sourceModuleId === module.id).map((view) => view.link.targetModuleId),
            internalInjections: injectionsByLink.get(linkId({ sourceModuleId: module.id, targetModuleId: module.id })) ?? [],
        });
    }

    const maxDependents = Math.max(0, ...[...modules.values()].map((view) => view.dependents.length));
    return { modules, links, maxDependents };
}

/** Доля числа зависимых от наибольшего, от 0 до 1. Корень, который не импортирует никто, получает 0. */
export function dependentsShare(view: ModuleView, maxDependents: number): number {
    return maxDependents === 0 ? 0 : view.dependents.length / maxDependents;
}

/**
 * Предмет внимания: что пользователь навёл или выбрал на холсте либо в правой панели.
 * По нему холст решает, какие модули и связи оставить яркими.
 */
export type Focus =
    | { readonly kind: 'module'; readonly id: string }
    | { readonly kind: 'link'; readonly id: string }
    | { readonly kind: 'link-category'; readonly category: LinkCategory }
    | { readonly kind: 'module-kind'; readonly moduleKind: ModuleKind };

/** Модули и связи, которые остаются яркими; остальные холст приглушает. */
export interface Emphasis {
    readonly moduleIds: ReadonlySet<string>;
    readonly linkIds: ReadonlySet<string>;
}

export function emphasisOf(view: GraphView, focus: Focus | null): Emphasis | null {
    if (focus === null) return null;
    const emphasisOfLinks = (links: ReadonlyArray<LinkView>, extraModuleIds: ReadonlyArray<string> = []): Emphasis => ({
        moduleIds: new Set([...extraModuleIds, ...links.flatMap(({ link }) => [link.sourceModuleId, link.targetModuleId])]),
        linkIds: new Set(links.map((linkView) => linkView.id)),
    });
    switch (focus.kind) {
        case 'module':
            return emphasisOfLinks(view.links.filter(({ link }) => link.sourceModuleId === focus.id || link.targetModuleId === focus.id), [focus.id]);
        case 'link':
            return emphasisOfLinks(view.links.filter((linkView) => linkView.id === focus.id));
        case 'link-category':
            return emphasisOfLinks(view.links.filter((linkView) => linkView.category === focus.category));
        case 'module-kind': {
            // Для вида модуля подсвечиваются сами модули и связи, ведущие к ним: так видно, кто от них зависит.
            const moduleIds = [...view.modules.values()].filter(({ module }) => module.kind === focus.moduleKind).map(({ module }) => module.id);
            return {
                moduleIds: new Set(moduleIds),
                linkIds: new Set(view.links.filter(({ link }) => moduleIds.includes(link.targetModuleId)).map((linkView) => linkView.id)),
            };
        }
    }
}

/** Выбранный на холсте или в панели элемент: модуль или связь. Его подробности показывает правая панель. */
export type Selection = Extract<Focus, { kind: 'module' | 'link' }> | null;
