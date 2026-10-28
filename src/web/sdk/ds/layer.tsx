/**
 * Поверхности дизайн-системы по образцу `Layer` из Carbon и miracle-aramid. Панель получает фон,
 * скругление и внутренний отступ от своего уровня вложенности, а не от стилей экрана.
 *
 * Уровни чередуют два фона, как тема g10 в Carbon:
 *
 * | Уровень | Фон | Где |
 * |---|---|---|
 * | 0 | серый фон страницы | страница во вкладке |
 * | 1 | белый фон контейнера | панель на странице, карточка |
 * | 2 | серый | панель внутри панели |
 * | 3 | белый | следующий уровень, дальше уровень не растёт |
 *
 * Поэтому вложенная панель всегда отличается от внешней, и экрану не нужно выбирать цвет.
 *
 * ```tsx
 * <Panel title="Продажи">                 // уровень 1, белый
 *     <Layer padding={4}>…</Layer>        // уровень 2, серый
 * </Panel>
 * ```
 *
 * Поверхность со смысловым цветом (`tone`) берёт фон из смысловых цветов учёта, а не из уровня:
 * так зона «Проведено в 1С» залита цветом предупреждения. Уровень вложенности она всё равно
 * увеличивает: панель внутри неё опять отличается фоном.
 */
import { Card, theme, type GlobalToken } from 'antd';
import { createContext, useContext, type ReactNode } from 'react';
import { accountingColors, type AccountingColor, type AccountingTone } from '../../common/theme';
import { spacing, type SpacingStep } from './layout';

/** Уровень поверхности: 0 — страница, 1–3 — вложенные панели. */
export type LayerLevel = 0 | 1 | 2 | 3;

/**
 * Уровень и фоны ближайшей поверхности. `null` вне любой поверхности: это страница, её фоны
 * `useLayer` берёт из темы.
 */
const LayerContext = createContext<LayerColors | null>(null);

/** Ограничивает уровень диапазоном 0–3. */
function clampLevel(level: number): LayerLevel {
    return Math.max(0, Math.min(3, level)) as LayerLevel;
}

/** Фон поверхности и более тёмный фон её заголовка, например шапки таблицы. */
export interface LayerColors {
    readonly level: LayerLevel;
    readonly background: string;
    readonly backgroundStrong: string;
}

/**
 * Фоны уровня. Нечётные уровни белые, чётные серые. Более тёмный фон заголовка — полупрозрачная
 * заливка: она ложится поверх фона поверхности и темнит любой из них одинаково.
 */
function levelColors(level: LayerLevel, token: GlobalToken): LayerColors {
    return { level, background: level % 2 === 1 ? token.colorBgContainer : token.colorBgLayout, backgroundStrong: token.colorFillTertiary };
}

/**
 * Уровень и фоны ближайшей поверхности, у поверхности со смысловым цветом — её цвета. Нужны
 * компонентам, которые рисуют фон сами: ячейки таблицы Ant Design закрашивают себя и без
 * настройки перекрыли бы фон поверхности.
 */
export function useLayer(): LayerColors {
    const { token } = theme.useToken();
    return useContext(LayerContext) ?? levelColors(0, token);
}

/**
 * Фоны поверхности со смысловым цветом: светлый или яркий фон, а для заголовка — следующий
 * по насыщенности. У яркого фона темнее только полупрозрачная заливка поверх него.
 */
function toneColors(level: LayerLevel, color: AccountingColor, emphasis: 'subtle' | 'strong'): LayerColors {
    return emphasis === 'strong'
        ? { level, background: color.backgroundStrong, backgroundStrong: color.backgroundStrong }
        : { level, background: color.background, backgroundStrong: color.backgroundStrong };
}

/** Свойства поверхности. */
export interface LayerProperties {
    /** Явный уровень вместо следующего за родительским. Нужен редко: обычно уровень считается сам. */
    readonly level?: LayerLevel | undefined;
    /** Смысловой цвет поверхности вместо фона уровня. */
    readonly tone?: AccountingTone | undefined;
    /**
     * Насыщенность смыслового цвета: `subtle` — светлый фон, `strong` — яркий. Так фон покупателя
     * в рассрочках показывает размер долга.
     */
    readonly emphasis?: 'subtle' | 'strong' | undefined;
    /** Внутренний отступ — шаг шкалы отступов, по умолчанию 5 (16 px). `0` — без отступа. */
    readonly padding?: SpacingStep | 0 | undefined;
    readonly children?: ReactNode;
}

/**
 * Поверхность без заголовка: фон уровня или смысловой цвет, скругление карточек Ant Design
 * и внутренний отступ из шкалы. Ширину, как любой компонент дизайн-системы, получает от места.
 */
export function Layer({ level, tone, emphasis = 'subtle', padding = 5, children }: LayerProperties) {
    const { token } = theme.useToken();
    const own = level ?? clampLevel(useLayer().level + 1);
    const colors = tone === undefined ? levelColors(own, token) : toneColors(own, accountingColors(token)[tone], emphasis);
    return (
        <LayerContext.Provider value={colors}>
            <div style={{ background: colors.background, borderRadius: token.borderRadiusLG, padding: padding === 0 ? 0 : spacing[padding] }}>
                {children}
            </div>
        </LayerContext.Provider>
    );
}

/** Свойства панели с заголовком. */
export interface PanelProperties {
    /** Заголовок панели. Без него панель выглядит как карточка Ant Design без шапки. */
    readonly title?: ReactNode;
    /** Элементы справа в шапке, например кнопка «Создать». */
    readonly extra?: ReactNode;
    /** Внутренний отступ по умолчанию, как у карточки Ant Design размера `small`. */
    readonly children?: ReactNode;
}

/**
 * Панель с заголовком: карточка Ant Design, которая занимает следующий уровень поверхностей.
 * Фон берётся из уровня, поэтому панель внутри панели серая, а не белая, как раньше карточка
 * в карточке. Шапку, рамку и отступы рисует сама карточка: их оформление остаётся за Ant Design.
 */
export function Panel({ title, extra, children }: PanelProperties) {
    const { token } = theme.useToken();
    const colors = levelColors(clampLevel(useLayer().level + 1), token);
    return (
        <LayerContext.Provider value={colors}>
            <Card size="small" title={title} extra={extra} style={{ background: colors.background }}>
                {children}
            </Card>
        </LayerContext.Provider>
    );
}
