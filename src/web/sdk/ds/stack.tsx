/**
 * Стек дизайн-системы, как Stack в Carbon: расстояние между соседними элементами задаёт родитель
 * через `gap`, а сами элементы внешних отступов не имеют. Расстояние берётся только из шкалы
 * отступов, поэтому соседние блоки на разных экранах разделены одинаково.
 *
 * ```tsx
 * <Stack gap={5}>                                  // 16 px между блоками сверху вниз
 *     <ShiftHeader />
 *     <ActionTiles />
 * </Stack>
 * <Stack orientation="horizontal" gap={3} wrap>   // 8 px между кнопками в ряд
 * ```
 */
import { Flex } from 'antd';
import type { ReactNode } from 'react';
import { spacing, type SpacingStep } from './layout';

/** Свойства стека. */
export interface StackProperties {
    /** Шаг шкалы отступов между элементами: 3 — 8 px, 5 — 16 px, 7 — 32 px. */
    readonly gap: SpacingStep;
    /** Направление: сверху вниз (по умолчанию) или в ряд. */
    readonly orientation?: 'vertical' | 'horizontal' | undefined;
    /** Выравнивание элементов поперёк направления стека, как `align-items`. */
    readonly align?: 'flex-start' | 'center' | 'flex-end' | 'baseline' | 'stretch' | undefined;
    /** Распределение элементов вдоль направления стека, как `justify-content`. */
    readonly justify?: 'flex-start' | 'center' | 'flex-end' | 'space-between' | undefined;
    /** Переносить элементы ряда на следующую строку, когда им не хватает места. */
    readonly wrap?: boolean | undefined;
    readonly children?: ReactNode;
}

/** Стек элементов с расстоянием из шкалы отступов. Построен на `Flex` Ant Design. */
export function Stack({ gap, orientation = 'vertical', align, justify, wrap = false, children }: StackProperties) {
    return (
        <Flex vertical={orientation === 'vertical'} gap={spacing[gap]} wrap={wrap} {...(align === undefined ? {} : { align })} {...(justify === undefined ? {} : { justify })}>
            {children}
        </Flex>
    );
}
