/**
 * Разделитель дизайн-системы: горизонтальная линия между блоками внутри поверхности, как Divider
 * в Carbon. Отступы вокруг линии задаёт родительский `Stack`, у самого разделителя их нет.
 *
 * ```tsx
 * <Stack gap={5}>
 *     <Text>Итого: 8 000 ₽</Text>
 *     <Divider dashed />                // пунктир отделяет связанный, но отдельный итог
 *     <Text>Возвраты: −3 000 ₽</Text>
 * </Stack>
 * ```
 *
 * Сплошная линия разделяет независимые блоки. Пунктир показывает, что блок под ним продолжает
 * предыдущий, а не начинает новый раздел: так в таблице данных пунктиром разделены подстроки одной записи.
 * Цвет линии общий с границами таблицы (`colorBorder`), поэтому разделители выглядят одинаково.
 */
import { theme } from 'antd';

/** Свойства разделителя. */
export interface DividerProperties {
    /** Пунктирная линия вместо сплошной. */
    readonly dashed?: boolean | undefined;
}

/** Горизонтальный разделитель на всю ширину родителя. */
export function Divider({ dashed = false }: DividerProperties) {
    const { token } = theme.useToken();
    return <hr style={{ width: '100%', margin: 0, border: 0, borderTop: `1px ${dashed ? 'dashed' : 'solid'} ${token.colorBorder}` }} />;
}
