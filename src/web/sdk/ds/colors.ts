/**
 * Смысловые цвета учёта для компонентов: итог, долг, переплата, предупреждение. Сами цвета
 * определены рядом с темой приложения (`accountingColors`), здесь они берутся из текущей темы.
 *
 * ```tsx
 * const colors = useAccountingColors();
 * <ConfigProvider theme={{ components: { Switch: { colorPrimary: colors.warning.solid } } }}>
 * ```
 *
 * Текст окрашивают не этим хуком, а свойством `tone` компонентов `Text`.
 */
import { theme } from 'antd';
import { accountingColors, type AccountingColor, type AccountingTone } from '../../common/theme';

export type { AccountingColor, AccountingTone };

/** Смысловые цвета учёта в текущей теме Ant Design. */
export function useAccountingColors(): { readonly [Tone in AccountingTone]: AccountingColor } {
    return accountingColors(theme.useToken().token);
}
