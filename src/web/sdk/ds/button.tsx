/**
 * Кнопка дизайн-системы: вид кнопки Ant Design, размеры Carbon. Ant Design даёт кнопкам высоту
 * 24, 32 и 40 px, а Carbon — 32, 40, 48 и 64 px, и крупные действия раньше получали высоту
 * inline-стилем на каждом экране. Здесь размер выбирается по имени, а высота, внутренний отступ
 * и размер шрифта берутся из одной таблицы.
 *
 * ```tsx
 * <Button type="primary" size="lg" icon={<Icons.acceptPayment />}>Взнос</Button>
 * ```
 *
 * Ширину кнопка получает от места: в ряду действий — по содержимому, в колонке сетки со свойством
 * `block` — всю ширину колонки, как fluid-кнопка Carbon.
 */
import { Button as AntButton, theme, type ButtonProps as AntButtonProperties, type GlobalToken } from 'antd';
import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import { spacing } from './layout';

/** Размер кнопки по шкале Carbon: `sm` — 32 px, `md` — 40 px, `lg` — 48 px, `xl` — 64 px. */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

/**
 * Высота, внутренний отступ по горизонтали и шрифт для каждого размера. Шрифт растёт вместе
 * с кнопкой: на кнопке 64 px текст 14 px выглядел бы потерянным. Размеры шрифта — токены темы.
 */
function sizeStyle(size: ButtonSize, token: GlobalToken): CSSProperties {
    switch (size) {
        case 'sm':
            return { height: 32, paddingInline: spacing[5], fontSize: token.fontSize };
        case 'md':
            return { height: 40, paddingInline: spacing[5], fontSize: token.fontSize };
        case 'lg':
            return { height: 48, paddingInline: spacing[6], fontSize: token.fontSizeLG };
        case 'xl':
            return { height: 64, paddingInline: spacing[9], fontSize: token.fontSizeXL };
    }
}

/** Свойства кнопки. */
export interface ButtonProperties {
    /**
     * Вид кнопки Ant Design: `primary` — главное действие, `default` — обычное, `dashed`,
     * `text` и `link` — второстепенные действия без заливки. По умолчанию `default`.
     */
    readonly type?: AntButtonProperties['type'];
    /** Размер по шкале Carbon, по умолчанию `sm` (32 px, как обычная кнопка Ant Design). */
    readonly size?: ButtonSize | undefined;
    /** Опасное действие, например удаление: кнопка окрашивается цветом ошибки. */
    readonly danger?: boolean | undefined;
    /** Растянуть кнопку на всю ширину места, например колонки сетки. */
    readonly block?: boolean | undefined;
    /** Значок из реестра `Icons`. */
    readonly icon?: ReactNode;
    readonly disabled?: boolean | undefined;
    /** Кнопка показывает ожидание и не нажимается. */
    readonly loading?: boolean | undefined;
    /** Тип кнопки HTML: `submit` отправляет форму. */
    readonly htmlType?: AntButtonProperties['htmlType'];
    readonly onClick?: MouseEventHandler<HTMLElement> | undefined;
    /** Название для чтения с экрана; обязательно для кнопки без подписи. */
    readonly 'aria-label'?: string | undefined;
    readonly children?: ReactNode;
}

/** Кнопка с видом Ant Design и размером Carbon. */
export function Button({ type = 'default', size = 'sm', danger, block, icon, disabled, loading, htmlType, onClick, 'aria-label': label, children }: ButtonProperties) {
    const { token } = theme.useToken();
    return (
        <AntButton
            type={type}
            style={sizeStyle(size, token)}
            {...(danger === undefined ? {} : { danger })}
            {...(block === undefined ? {} : { block })}
            {...(icon === undefined ? {} : { icon })}
            {...(disabled === undefined ? {} : { disabled })}
            {...(loading === undefined ? {} : { loading })}
            {...(htmlType === undefined ? {} : { htmlType })}
            {...(onClick === undefined ? {} : { onClick })}
            {...(label === undefined ? {} : { 'aria-label': label })}
        >
            {children}
        </AntButton>
    );
}
