import { Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useTabTitle } from '../tabs/window-tabs';

/** Свойства каркаса страницы. */
export interface PageProperties {
    /** Заголовок над содержимым страницы. */
    readonly title: string;
    /**
     * Заголовок вкладки. По умолчанию совпадает с заголовком страницы. При `null` страница
     * заголовок вкладки не задаёт: его задаёт другой компонент той же вкладки.
     */
    readonly tabTitle?: string | null;
    /** Отметки состояния под заголовком, например «Проведён». */
    readonly marks?: ReactNode;
    /** Кнопки действий справа от заголовка. */
    readonly actions?: ReactNode;
    readonly children?: ReactNode;
}

/**
 * Каркас страницы вкладки: заголовок с отметками состояния, кнопки действий и содержимое.
 * Страница сообщает свой заголовок вкладке, поэтому каркас выводится только на странице,
 * показанной во вкладке. Раскладку содержимого экран задаёт сам компонентами Ant Design.
 */
export function Page({ title, tabTitle = title, marks, actions, children }: PageProperties) {
    useTabTitle(tabTitle);
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
