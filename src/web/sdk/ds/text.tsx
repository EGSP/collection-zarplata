/**
 * Текст дизайн-системы по образцу `Text` из miracle-aramid и наборов типов Carbon: роль текста
 * задаётся компонентом, а размер и межстрочный интервал роль берёт из токенов Ant Design.
 * Экран не пишет `fontSize: 12`: он выбирает подпись или пояснение, и все подписи приложения
 * остаются одного размера.
 *
 * | Компонент | Роль | Размер |
 * |---|---|---|
 * | `Text` | основной текст | 14 px, `expressive` — 16 px |
 * | `Text.Heading` | заголовок раздела или блока | по `variant`, от 14 до 30 px |
 * | `Text.Label` | подпись к значению, сообщение | 12 px, `expressive` — 14 px |
 * | `Text.Helper` | пояснение под значением, второстепенный цвет | 12 px, `expressive` — 14 px |
 *
 * ```tsx
 * <Text.Heading variant="03">Продажа</Text.Heading>
 * <Text tone="debt" strong><Money value={debt} /></Text>
 * <Text.Helper>внесено <Money value={paid} /></Text.Helper>
 * ```
 *
 * Все роли построены на `Typography.Text` Ant Design и сохраняют его поведение: многоточие
 * с подсказкой, второстепенный цвет. Внешних отступов у текста нет, как у других компонентов.
 */
import { theme, Typography, type GlobalToken } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { accountingColors, type AccountingTone } from '../../common/theme';

/**
 * Цвет текста: `secondary` — второстепенный серый Ant Design, остальные — смысловые цвета учёта.
 * Без `tone` текст основного цвета.
 */
export type TextTone = 'secondary' | AccountingTone;

/** Общие свойства всех ролей текста. */
export interface TextCommonProperties {
    /** Цвет по смыслу. */
    readonly tone?: TextTone | undefined;
    /** Жирное начертание, например у итога. */
    readonly strong?: boolean | undefined;
    /** Обрезать строку многоточием; полный текст виден в подсказке. */
    readonly ellipsis?: boolean | undefined;
    /** Не переносить текст: сумма в узкой ячейке остаётся одной строкой. */
    readonly noWrap?: boolean | undefined;
    readonly children?: ReactNode;
}

/** Свойства основного текста и подписей. */
export interface TextProperties extends TextCommonProperties {
    /**
     * Экспрессивный набор Carbon (`-02`): на ступень крупнее продуктивного (`-01`). Подходит
     * для заметного текста на рабочих местах, где важнее читаемость, чем плотность.
     */
    readonly expressive?: boolean | undefined;
}

/**
 * Ступень заголовка, как фиксированные заголовки Carbon: `01` и `02` — заголовки компонентов,
 * жирные 14 и 16 px; `03`–`05` — заголовки раздела обычного начертания 20, 24 и 30 px. Крупный
 * размер выделяет заголовок без жирности, как в Carbon.
 */
export type TextHeadingVariant = '01' | '02' | '03' | '04' | '05';

/** Свойства заголовка. */
export interface TextHeadingProperties extends TextCommonProperties {
    readonly variant: TextHeadingVariant;
}

/** Размер шрифта, межстрочный интервал и начертание роли. */
type Metrics = Pick<CSSProperties, 'fontSize' | 'lineHeight' | 'fontWeight'>;

/** Метрики ступени заголовка из токенов темы. */
function headingMetrics(variant: TextHeadingVariant, token: GlobalToken): Metrics {
    switch (variant) {
        case '01':
            return { fontSize: token.fontSize, lineHeight: token.lineHeight, fontWeight: token.fontWeightStrong };
        case '02':
            return { fontSize: token.fontSizeLG, lineHeight: token.lineHeightLG, fontWeight: token.fontWeightStrong };
        case '03':
            return { fontSize: token.fontSizeHeading4, lineHeight: token.lineHeightHeading4, fontWeight: 'normal' };
        case '04':
            return { fontSize: token.fontSizeHeading3, lineHeight: token.lineHeightHeading3, fontWeight: 'normal' };
        case '05':
            return { fontSize: token.fontSizeHeading2, lineHeight: token.lineHeightHeading2, fontWeight: 'normal' };
    }
}

/** Метрики основного текста и подписей: продуктивный набор или на ступень крупнее. */
function bodyMetrics(expressive: boolean, token: GlobalToken): Metrics {
    return expressive ? { fontSize: token.fontSizeLG, lineHeight: token.lineHeightLG } : { fontSize: token.fontSize, lineHeight: token.lineHeight };
}

/** Метрики подписи и пояснения. */
function smallMetrics(expressive: boolean, token: GlobalToken): Metrics {
    return expressive ? { fontSize: token.fontSize, lineHeight: token.lineHeight } : { fontSize: token.fontSizeSM, lineHeight: token.lineHeightSM };
}

/** Текст с метриками роли. Цвет `secondary` задаёт Ant Design, смысловые цвета — стиль. */
function RoleText({ metrics, tone, strong, ellipsis, noWrap, children }: TextCommonProperties & { readonly metrics: Metrics }) {
    const { token } = theme.useToken();
    const color = tone === undefined || tone === 'secondary' ? undefined : accountingColors(token)[tone].text;
    const style: CSSProperties = { ...metrics, ...(color === undefined ? {} : { color }), ...(noWrap === true ? { whiteSpace: 'nowrap' } : {}) };
    return (
        <Typography.Text
            style={style}
            {...(tone === 'secondary' ? { type: 'secondary' as const } : {})}
            {...(strong === undefined ? {} : { strong })}
            {...(ellipsis === true ? { ellipsis: { tooltip: children } } : {})}
        >
            {children}
        </Typography.Text>
    );
}

/** Основной текст. */
function TextBody({ expressive = false, ...common }: TextProperties) {
    return <RoleText metrics={bodyMetrics(expressive, theme.useToken().token)} {...common} />;
}

/** Заголовок раздела или блока. Строчный элемент: место заголовка задаёт стек или сетка. */
function TextHeading({ variant, ...common }: TextHeadingProperties) {
    return <RoleText metrics={headingMetrics(variant, theme.useToken().token)} {...common} />;
}

/** Подпись к значению, сообщение, подпись-снимок. Не для абзацев. */
function TextLabel({ expressive = false, ...common }: TextProperties) {
    return <RoleText metrics={smallMetrics(expressive, theme.useToken().token)} {...common} />;
}

/** Пояснение под значением: подпись второстепенного цвета, если цвет не задан явно. */
function TextHelper({ expressive = false, tone = 'secondary', ...common }: TextProperties) {
    return <RoleText metrics={smallMetrics(expressive, theme.useToken().token)} tone={tone} {...common} />;
}

/** Основной текст `Text` с ролями `Text.Heading`, `Text.Label` и `Text.Helper`. */
export const Text = Object.assign(TextBody, { Heading: TextHeading, Label: TextLabel, Helper: TextHelper });
