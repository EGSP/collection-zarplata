import { Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useWindowFrame, useWindowTitle } from '../window/window-scope';

/** Свойства каркаса страницы. */
export interface PageProperties {
    /** Заголовок над содержимым страницы. */
    readonly title: string;
    /**
     * Заголовок области окна, например вкладки. По умолчанию совпадает с заголовком страницы.
     * При `null` страница заголовок области не задаёт: его задаёт другой компонент той же области.
     */
    readonly windowTitle?: string | null;
    /** Отметки состояния рядом с заголовком, например «Проведён». */
    readonly marks?: ReactNode;
    /** Кнопки действий. */
    readonly actions?: ReactNode;
    readonly children?: ReactNode;
}

/**
 * Каркас страницы: заголовок с отметками состояния, кнопки действий и содержимое.
 * Страница сообщает свой заголовок ближайшей области окна, поэтому каркас выводится только
 * на странице, показанной в области окна. Раскладку содержимого экран задаёт сам компонентами Ant Design.
 *
 * Где стоят заголовок и кнопки, зависит от области. Во вкладке они выводятся над содержимым.
 * У модального окна есть рамка, и каркас выводит заголовок с отметками в шапку окна, а кнопки
 * в его нижнюю часть: иначе у окна было бы два заголовка, а кнопки уезжали бы при прокрутке формы.
 */
export function Page({ title, windowTitle = title, marks, actions, children }: PageProperties) {
    useWindowTitle(windowTitle);
    const frame = useWindowFrame();
    if (frame !== null) {
        return (
            <>
                {frame.header !== null &&
                    createPortal(
                        <Flex align="center" gap="small" wrap>
                            {title}
                            {marks !== undefined && <Flex>{marks}</Flex>}
                        </Flex>,
                        frame.header,
                    )}
                {frame.footer !== null &&
                    actions !== undefined &&
                    createPortal(
                        <Flex justify="flex-end" gap="small" wrap>
                            {actions}
                        </Flex>,
                        frame.footer,
                    )}
                <Flex vertical gap="middle">
                    {children}
                </Flex>
            </>
        );
    }
    return (
        <Flex vertical gap="middle">
            <Flex justify="space-between" align="flex-start" gap="middle" wrap>
                <Flex vertical gap="small">
                    <Typography.Title level={3} style={{ margin: 0 }}>
                        {title}
                    </Typography.Title>
                    {marks !== undefined && <Flex>{marks}</Flex>}
                </Flex>
                {actions !== undefined && (
                    <Flex gap="small" wrap>
                        {actions}
                    </Flex>
                )}
            </Flex>
            {children}
        </Flex>
    );
}
