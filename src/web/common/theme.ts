import type { GlobalToken, ThemeConfig } from 'antd';

/** Значения недоступных полей остаются читаемыми: режим просмотра отличается фоном и рамкой. */
const readableDisabledField = { colorTextDisabled: 'rgba(0, 0, 0, 0.75)' };

/**
 * Тема Ant Design для всех страниц клиента: приложения и графа модулей. Длительности анимаций
 * вдвое короче стандартных 0,1, 0,2 и 0,3 секунды: при стандартных подсветка под курсором
 * и появление выпадающих списков и окон заметно отстают от действия пользователя.
 *
 * Длительности заданы напрямую, а не через `motionUnit`: Ant Design округляет производные
 * значения до десятых долей секунды, и шаг 0,05 дал бы прежние 0,1 секунды.
 */
export const applicationTheme: ThemeConfig = {
    token: {
        motionDurationFast: '0.05s',
        motionDurationMid: '0.1s',
        motionDurationSlow: '0.15s',
    },
    // Общая тема применяется и к ячейкам табличных частей, и к полям обычных форм.
    // Цвет задаётся компонентам ввода: недоступные кнопки сохраняют привычное оформление.
    components: {
        Input: readableDisabledField,
        InputNumber: readableDisabledField,
        Select: { ...readableDisabledField, multipleItemColorDisabled: readableDisabledField.colorTextDisabled },
        DatePicker: { ...readableDisabledField, multipleItemColorDisabled: readableDisabledField.colorTextDisabled },
        Checkbox: readableDisabledField,
        Radio: readableDisabledField,
        Switch: readableDisabledField,
        Segmented: readableDisabledField,
    },
};

/** Смысл цвета в учёте магазина. Экраны выбирают цвет по смыслу, а не по оттенку палитры. */
export type AccountingTone = 'total' | 'debt' | 'overpayment' | 'warning';

/**
 * Оттенки одного смыслового цвета: текст суммы, заливка контрола (например переключателя)
 * с её состоянием при наведении, светлый фон области и чуть более тёмный фон её заголовка.
 */
export interface AccountingColor {
    readonly text: string;
    readonly solid: string;
    readonly solidHover: string;
    readonly background: string;
    readonly backgroundStrong: string;
}

/**
 * Смысловые цвета учёта, дополнение темы Ant Design. Значения берутся из токенов текущей темы,
 * поэтому смена темы меняет и их. Свои токены в `ThemeConfig` Ant Design не принимает, поэтому
 * цвета вычисляются из готовых токенов функцией, а не записаны в `applicationTheme`.
 *
 * - `total` — итог: синий основного цвета, как зона «Всего» в сводке периода;
 * - `debt` — долг покупателя: оранжевый, светлый фон и яркий фон отмечают больший долг;
 * - `overpayment` — переплата: зелёный;
 * - `warning` — предупреждение, например «Проведено в 1С»: жёлтый.
 */
export function accountingColors(token: GlobalToken): { readonly [Tone in AccountingTone]: AccountingColor } {
    return {
        total: { text: token.colorPrimaryText, solid: token.colorPrimary, solidHover: token.colorPrimaryHover, background: token.colorPrimaryBg, backgroundStrong: token.colorPrimaryBgHover },
        debt: { text: token.orange8, solid: token.orange6, solidHover: token.orange5, background: token.orange1, backgroundStrong: token.orange4 },
        overpayment: { text: token.green8, solid: token.green6, solidHover: token.green5, background: token.green1, backgroundStrong: token.green3 },
        warning: { text: token.colorWarningText, solid: token.colorWarning, solidHover: token.colorWarningHover, background: token.colorWarningBg, backgroundStrong: token.colorWarningBgHover },
    };
}
