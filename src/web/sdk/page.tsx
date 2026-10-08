import { Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useWindowTitle } from '../window/window-scope';

/** Свойства каркаса страницы. */
export interface PageProperties {
    /** Заголовок над содержимым страницы. */
    readonly title: string;
    /**
     * Заголовок области окна, например вкладки. По умолчанию совпадает с заголовком страницы.
     * При `null` страница заголовок области не задаёт: его задаёт другой компонент той же области.
     */
    readonly windowTitle?: string | null;
    /** Отметки состояния под заголовком, например «Проведён». */
    readonly marks?: ReactNode;
    /** Кнопки действий справа от заголовка. */
    readonly actions?: ReactNode;
    readonly children?: ReactNode;
}

/**
 * Каркас страницы: заголовок с отметками состояния, кнопки действий и содержимое.
 * Страница сообщает свой заголовок ближайшей области окна, поэтому каркас выводится только
 * на странице, показанной в области окна. Раскладку содержимого экран задаёт сам компонентами Ant Design.
 */
export function Page({ title, windowTitle = title, marks, actions, children }: PageProperties) {
    useWindowTitle(windowTitle);
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
