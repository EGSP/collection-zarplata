/**
 * Стек элементов формы Ant Design: поля `Form.Item`, пояснения и сообщения одной формы, например
 * в модальном окне. `Form.Item` по умолчанию добавляет снизу отступ 24 px, а элементы между
 * полями (сообщение об ошибке, пояснение) отступа не имеют, и экраны выравнивали их ручными
 * `marginTop` и `marginBottom`. Здесь отступ элемента формы убран, и расстояние между всеми
 * элементами задаёт стек из шкалы отступов.
 *
 * ```tsx
 * <Form form={form} layout="vertical">
 *     <FormStack>
 *         {failure !== null && <Alert type="error" title={failure} />}
 *         <Form.Item name="name" label="Имя"><Input /></Form.Item>
 *     </FormStack>
 * </Form>
 * ```
 *
 * Поля по описаниям объекта ставит `FieldGroup`; `FormStack` нужен формам, собранным из
 * `Form.Item` вручную.
 */
import { ConfigProvider, type ThemeConfig } from 'antd';
import type { ReactNode } from 'react';
import type { SpacingStep } from '../ds/layout';
import { Stack } from '../ds/stack';

/** Элементы формы без нижнего отступа: расстояние задаёт стек. */
const stackTheme: ThemeConfig = { components: { Form: { itemMarginBottom: 0 } } };

/** Свойства стека формы. */
export interface FormStackProperties {
    /** Шаг шкалы отступов между элементами, по умолчанию 6 (24 px, как прежний отступ `Form.Item`). */
    readonly gap?: SpacingStep | undefined;
    readonly children?: ReactNode;
}

/** Стек элементов формы с расстоянием из шкалы отступов вместо отступа `Form.Item`. */
export function FormStack({ gap = 6, children }: FormStackProperties) {
    return (
        <ConfigProvider theme={stackTheme}>
            <Stack gap={gap}>{children}</Stack>
        </ConfigProvider>
    );
}
