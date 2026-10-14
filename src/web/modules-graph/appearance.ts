/**
 * Подписи и оформление графа. Каждый признак закодирован своим каналом, чтобы признаки не спорили
 * друг с другом за цвет:
 *
 * - число зависимых — насыщенностью заливки одного оттенка и размером узла;
 * - вид модуля — формой узла, рамкой, штриховкой и значком, а не цветом;
 * - категория связи — цветом и рисунком штриха линии.
 *
 * Цвета связей взяты из палитры Окабэ и Ито: её оттенки различают и люди с нарушениями цветового
 * зрения. Штрих повторяет различие цветом, поэтому категории различимы и в оттенках серого.
 */
import type { GlobalToken } from 'antd';
import type { CSSProperties } from 'react';
import type { ClassKind, ModuleKind, ProviderShape } from '../../common/modules-graph';
import type { LinkCategory } from './graph-model';

export const moduleKindTitles: Readonly<Record<ModuleKind, string>> = {
    regular: 'Обычный',
    global: 'Глобальный',
    dynamic: 'Динамический',
    core: 'Ядро Nest',
};

export const moduleKindDescriptions: Readonly<Record<ModuleKind, string>> = {
    regular: 'Экспорт доступен только модулям, которые его импортируют.',
    global: 'Помечен @Global(): экспорт доступен всем модулям без импорта.',
    dynamic: 'Подключён динамическим модулем, например через forRoot() или register().',
    core: 'Служебный модуль Nest: HttpAdapterHost, ModulesContainer и другие средства ядра.',
};

export const linkCategoryTitles: Readonly<Record<LinkCategory, string>> = {
    import: 'Импорт',
    unused: 'Неиспользуемый импорт',
    root: 'Подключение в корне',
    global: 'Через @Global()',
    reexport: 'Через реэкспорт',
    'forward-reference': 'Через forwardRef()',
};

export const linkCategoryDescriptions: Readonly<Record<LinkCategory, string>> = {
    import: 'Модуль указан в imports декоратора @Module(), и его провайдеры внедряются.',
    unused: 'Модуль указан в imports, но ни один класс не получает его провайдеры. Импорт лишний, если он не нужен ради реэкспорта или порядка инициализации.',
    root: 'Корневой модуль импортирует модуль, чтобы подключить его к приложению; внедрения через такой импорт не нужны.',
    global: 'Импорта нет: модуль глобальный, и Nest открывает его экспорт всем модулям.',
    reexport: 'Импорта нет: провайдер доступен, потому что импортированный модуль экспортирует этот модуль дальше.',
    'forward-reference': 'Импорт записан через forwardRef(): модули ссылаются друг на друга, и Nest откладывает разрешение ссылки.',
};

export const classKindTitles: Readonly<Record<ClassKind, string>> = {
    module: 'Класс модуля',
    provider: 'Провайдер',
    controller: 'Контроллер',
    enhancer: 'Улучшитель',
};

export const providerShapeTitles: Readonly<Record<ProviderShape, string | undefined>> = {
    class: undefined,
    value: 'useValue',
    factory: 'useFactory',
    alias: 'useExisting',
};

/** Рисунок линии связи: цвет, штрих и толщина без учёта числа внедрений. */
export interface LinkStroke {
    readonly color: string;
    /** Значение `stroke-dasharray`; без него линия сплошная. */
    readonly dash?: string;
    readonly width: number;
}

/**
 * Рисунок связи каждой категории. Обычный импорт тёмный и сплошной: он самый частый и служит
 * фоном для остальных. Подключение в корне светлое и тонкое: таких связей много, и они важны меньше
 * остальных. Неиспользуемый импорт рисуется красно-оранжевыми точками: его нужно замечать.
 */
export const linkStrokes: Readonly<Record<LinkCategory, LinkStroke>> = {
    import: { color: '#3a3a3a', width: 1.6 },
    unused: { color: '#D55E00', dash: '1 5', width: 2.2 },
    root: { color: '#b0b0b0', width: 1.2 },
    global: { color: '#E69F00', dash: '9 5', width: 1.6 },
    reexport: { color: '#009E73', dash: '12 4 2 4', width: 1.6 },
    'forward-reference': { color: '#CC79A7', width: 2.2 },
};

/**
 * Оттенки шкалы «число зависимых» от светлого к насыщенному. Шкала одноцветная: порядок читается
 * по насыщенности, а цвет не путается с цветами связей.
 */
export function dependentsPalette(token: GlobalToken): ReadonlyArray<string> {
    return [token.blue1, token.blue2, token.blue3, token.blue4, token.blue5, token.blue6, token.blue7];
}

/** Оттенок шкалы для доли зависимых от 0 до 1. */
export function dependentsColor(share: number, token: GlobalToken): string {
    const palette = dependentsPalette(token);
    return palette[Math.round(share * (palette.length - 1))] ?? palette[0] ?? token.colorBgContainer;
}

/** На насыщенных оттенках шкалы тёмный текст читается плохо. */
export function dependentsTextColor(share: number, token: GlobalToken): string {
    return share > 0.6 ? token.colorWhite : token.colorText;
}

/**
 * Размер узла по доле зависимых. Площадь растёт быстрее ширины, поэтому разница между модулем
 * с одним и с десятью зависимыми заметна, а крупнейший узел не занимает полэкрана.
 */
export function nodeSize(share: number): { width: number; height: number } {
    const scale = 1 + 0.7 * Math.sqrt(share);
    return { width: Math.round(190 * scale), height: Math.round(64 * scale) };
}

/**
 * Форма узла по виду модуля поверх заливки `background`:
 * - обычный — прямоугольник со скруглёнными углами и сплошной рамкой;
 * - глобальный — капсула с диагональной штриховкой: модуль «пронизывает» всё приложение;
 * - динамический — двойная рамка: модуль собран методом настройки из нескольких частей;
 * - ядро Nest — пунктирная рамка: модуль создан фреймворком, а не приложением.
 */
export function moduleShapeStyle(kind: ModuleKind, background: string, height: number, token: GlobalToken): CSSProperties {
    const borderColor = token.colorTextSecondary;
    switch (kind) {
        case 'regular':
            return { background, border: `2px solid ${borderColor}`, borderRadius: token.borderRadiusLG };
        case 'global':
            return {
                backgroundColor: background,
                backgroundImage: 'repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.13) 0 2px, transparent 2px 9px)',
                border: `2px solid ${borderColor}`,
                borderRadius: height / 2,
            };
        case 'dynamic':
            return { background, border: `5px double ${borderColor}`, borderRadius: token.borderRadiusLG };
        case 'core':
            return { background, border: `2px dashed ${borderColor}`, borderRadius: token.borderRadiusLG };
    }
}

/** Склонение существительного после числа: 1 внедрение, 2 внедрения, 5 внедрений. */
export function plural(count: number, one: string, few: string, many: string): string {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    if (last === 1) return one;
    if (last >= 2 && last <= 4) return few;
    return many;
}
