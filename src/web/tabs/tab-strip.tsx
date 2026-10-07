import { HomeOutlined } from '@ant-design/icons';
import { Tabs, theme, Tooltip } from 'antd';
import { useWindowTabs } from './window-tabs';

/** Ключ вкладки главного экрана в полосе. Номера остальных вкладок числовые и с ним не совпадают. */
const homeKey = 'home';

/** Наибольшая ширина заголовка вкладки в пикселях: более длинный обрезается и целиком виден в подсказке. */
const titleWidth = 240;

/**
 * Полоса вкладок над содержимым страницы. Первой стоит вкладка главного экрана: она без заголовка
 * и не закрывается. Страницы вкладок полоса не выводит: их показывает `TabPages`, потому что
 * страницы скрытых вкладок должны оставаться смонтированными.
 */
export function TabStrip() {
    const { token } = theme.useToken();
    const { tabs, activeId, activate, close } = useWindowTabs();
    return (
        <Tabs
            type="editable-card"
            size="small"
            hideAdd
            activeKey={activeId === null ? homeKey : String(activeId)}
            onChange={(key) => activate(key === homeKey ? null : Number(key))}
            onEdit={(key, action) => {
                if (action === 'remove' && typeof key === 'string') close(Number(key));
            }}
            tabBarStyle={{ margin: 0, paddingInline: token.paddingLG, paddingBlockStart: token.paddingXS }}
            items={[
                {
                    key: homeKey,
                    closable: false,
                    label: (
                        <Tooltip title="Главная">
                            {/* Отступ иконки рассчитан на текст после неё, а текста у этой вкладки нет. */}
                            <HomeOutlined aria-label="Главная" style={{ margin: 0 }} />
                        </Tooltip>
                    ),
                },
                ...tabs.map((tab) => {
                    const title = tab.title ?? 'Загрузка…';
                    return {
                        key: String(tab.id),
                        label: (
                            <span
                                title={title}
                                style={{ display: 'inline-block', maxWidth: titleWidth, overflow: 'hidden', textOverflow: 'ellipsis', verticalAlign: 'bottom' }}
                            >
                                {title}
                            </span>
                        ),
                    };
                }),
            ]}
        />
    );
}
