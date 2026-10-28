import { useLogout } from '@refinedev/core';
import { App, Button, ConfigProvider, Divider, Drawer, Flex, Layout, Menu, Result, theme, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import type { ShellSubsystem } from '../../server/ui/descriptions';
import { Pending } from '../common/pending';
import { useMetadata } from '../data-provider/metadata';
import { Icons } from '../sdk/ds/icons';
import { TabPages } from '../tabs/tab-pages';
import { TabStrip } from '../tabs/tab-strip';
import { useWindowTabs } from '../tabs/window-tabs';
import { navigationWidths, useNavigationStrategy } from './navigation-strategies';
import { SubsystemDialog, SubsystemMenu } from './subsystems';
import { WorkplaceMenu } from './workplaces';

/**
 * Раскладка приложения: слева боковая панель, справа полоса вкладок и страница активной вкладки.
 * В панели сверху вниз стоят кнопка Switcher, рабочие места, подсистемы и служебные пункты:
 * документация, граф модулей и выход.
 *
 * Панель адаптивна, как в Carbon UI Shell. Как она показывается и что делает Switcher, решает
 * стратегия для точки перелома окна (`navigation-strategies.ts`): начиная с `max` панель сдвигает
 * страницу (push), на более узком окне выдвигается поверх неё (overlay). Точку окна раскладка
 * получает от контейнера окна в корне приложения, а страницы вкладок от своих контейнеров. Раскладка хранит только признак,
 * развёрнута ли панель, и выводит закреплённую панель и выдвижную так, как велит стратегия.
 * Сетки внутри вкладки считают точки перелома по своему контейнеру и сами учитывают ширину панели.
 *
 * Страницы строятся по описаниям объектов, поэтому раскладка показывает их только после
 * загрузки описаний: странице не нужно самой обрабатывать ожидание и ошибку загрузки.
 */
export function ApplicationLayout() {
    const { token } = theme.useToken();
    const strategy = useNavigationStrategy();
    // Нажатие Switcher запоминается вместе со стратегией, при которой сделано. Смена стратегии
    // сбрасывает его сразу при отрисовке: иначе выбор вернулся бы, когда окно снова станет прежней ширины.
    const [toggle, setToggle] = useState<{ readonly strategy: string; readonly expanded: boolean } | null>(null);
    if (toggle !== null && toggle.strategy !== strategy.name) setToggle(null);
    const expanded = toggle !== null && toggle.strategy === strategy.name ? toggle.expanded : strategy.expandedByDefault;
    const presentation = strategy.present(expanded);
    const setExpanded = (value: boolean) => setToggle({ strategy: strategy.name, expanded: value });
    const collapse = () => setExpanded(false);
    const afterNavigation = () => {
        if (strategy.collapsesOnNavigation) collapse();
    };
    // Окно подсистемы выводится здесь, а не в меню: выдвинутая панель закрывается при его открытии.
    const [openedSubsystem, setOpenedSubsystem] = useState<ShellSubsystem | null>(null);
    const openSubsystem = (subsystem: ShellSubsystem) => {
        setOpenedSubsystem(subsystem);
        afterNavigation();
    };
    const collapsed = presentation.docked === 'rail';
    return (
        <Layout style={{ height: '100vh' }}>
            {/* Свёрнутое меню Ant Design по умолчанию шире полосы (80 px), поэтому его ширина выровнена по панели. */}
            <ConfigProvider theme={{ components: { Menu: { collapsedWidth: navigationWidths.rail } } }}>
                <Layout.Sider
                    theme="light"
                    collapsible
                    collapsed={collapsed}
                    trigger={null}
                    width={navigationWidths.expanded}
                    collapsedWidth={navigationWidths.rail}
                    style={{ borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}
                >
                    <NavigationPanel
                        collapsed={collapsed}
                        switcherTitle={strategy.switcherTitle(expanded)}
                        onSwitch={() => setExpanded(!expanded)}
                        onNavigate={afterNavigation}
                        onOpenSubsystem={openSubsystem}
                    />
                </Layout.Sider>
            </ConfigProvider>
            {/* Drawer закрывается по Esc и нажатию на затемнение; панель внутри него та же, только развёрнутая. */}
            <Drawer
                open={presentation.overlay}
                placement="left"
                size={navigationWidths.expanded}
                closable={false}
                onClose={collapse}
                styles={{ body: { padding: 0 } }}
            >
                <NavigationPanel
                    collapsed={false}
                    switcherTitle={strategy.switcherTitle(expanded)}
                    onSwitch={collapse}
                    onNavigate={afterNavigation}
                    onOpenSubsystem={openSubsystem}
                />
            </Drawer>
            {openedSubsystem === null ? null : <SubsystemDialog subsystem={openedSubsystem} onClose={() => setOpenedSubsystem(null)} />}
            {/* Без нулевой наименьшей ширины длинная полоса вкладок растянула бы область шире окна. */}
            <Layout.Content style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <TabStrip />
                {/* Прокручивается страница вкладки, а не вся область: полоса вкладок остаётся на месте. */}
                <div style={{ flex: 1, minHeight: 0 }}>
                    <PageContent />
                </div>
            </Layout.Content>
        </Layout>
    );
}

/** Свойства содержимого боковой панели. */
interface NavigationPanelProperties {
    /** Панель свёрнута в полосу иконок: заголовки пунктов скрыты в подсказки. */
    readonly collapsed: boolean;
    /** Подсказка кнопки Switcher: что произойдёт по нажатию. */
    readonly switcherTitle: string;
    readonly onSwitch: () => void;
    /** Пользователь перешёл на страницу или открыл адрес: выдвинутая панель закрывается. */
    readonly onNavigate: () => void;
    readonly onOpenSubsystem: (subsystem: ShellSubsystem) => void;
}

/**
 * Содержимое боковой панели. Одно и то же в закреплённой панели и в выдвинутой поверх страницы,
 * поэтому пункты в обоих режимах совпадают. Switcher и рабочие места отделены разделителями;
 * прокручиваются только подсистемы, а служебные пункты стоят внизу.
 */
function NavigationPanel({ collapsed, switcherTitle, onSwitch, onNavigate, onOpenSubsystem }: NavigationPanelProperties) {
    const { token } = theme.useToken();
    return (
        <Flex vertical style={{ height: '100%' }}>
            <Flex align="center" gap={token.marginXS} justify={collapsed ? 'center' : 'flex-start'} style={{ padding: token.paddingXS }}>
                <Tooltip title={switcherTitle} placement="right">
                    <Button type="text" aria-label={switcherTitle} icon={<Icons.switcher />} onClick={onSwitch} />
                </Tooltip>
                {collapsed ? null : (
                    <Typography.Title level={5} ellipsis style={{ margin: 0 }}>
                        Учёт зарплаты и продаж
                    </Typography.Title>
                )}
            </Flex>
            <Divider style={{ margin: 0 }} />
            <WorkplaceSection onNavigate={onNavigate} />
            <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
                <SubsystemMenu onOpen={onOpenSubsystem} />
            </div>
            <ServiceMenu onNavigate={onNavigate} />
        </Flex>
    );
}

/** Рабочие места с разделителем под ними. Если рабочих мест нет, не выводится и разделитель. */
function WorkplaceSection({ onNavigate }: { readonly onNavigate: () => void }) {
    const hasWorkplaces = (useMetadata().data?.shell.workplaces.length ?? 0) > 0;
    if (!hasWorkplaces) return null;
    return (
        <>
            <WorkplaceMenu onNavigate={onNavigate} />
            <Divider style={{ margin: 0 }} />
        </>
    );
}

function PageContent() {
    const metadata = useMetadata();
    if (metadata.data !== undefined) return <TabPages />;
    if (!metadata.isError) return <Pending />;
    return (
        <Result
            status="error"
            title="Не удалось загрузить описания объектов"
            subTitle={metadata.error.message}
            extra={
                <Button type="primary" onClick={() => void metadata.refetch()}>
                    Повторить
                </Button>
            }
        />
    );
}

/**
 * Служебные пункты под подсистемами: документация, граф модулей и выход. Это пункты меню, а не кнопки,
 * чтобы в полосе иконок они сворачивались так же, как подсистемы.
 *
 * Документация и граф модулей открываются в новой вкладке браузера, а не во вкладке приложения:
 * у сайта документации своё меню и оформление, у графа свой каркас с холстом во всё окно.
 * Внутри окна приложения они повторяли бы его каркас.
 *
 * Выход закрывает все вкладки, поэтому при несохранённых изменениях на любой из них спрашивает подтверждение.
 */
function ServiceMenu({ onNavigate }: { readonly onNavigate: () => void }) {
    const { modal } = App.useApp();
    const { hasUnsavedChanges } = useWindowTabs();
    const { mutate: logout, isPending } = useLogout();
    const confirmLogout = () => {
        if (!hasUnsavedChanges()) return logout();
        modal.confirm({
            closable: true,
            title: 'Выйти без сохранения?',
            content: 'На открытых вкладках есть несохранённые изменения. После выхода они будут потеряны.',
            okText: 'Выйти без сохранения',
            cancelText: 'Остаться',
            onOk: () => logout(),
        });
    };
    // Адрес открывается по нажатию на пункт, а не ссылкой в подписи: в полосе иконок подпись скрыта и нажимают иконку.
    const openInBrowserTab = (path: string) => {
        window.open(path, '_blank', 'noopener');
        onNavigate();
    };
    return (
        <Menu
            mode="inline"
            selectable={false}
            style={{ borderInlineEnd: 'none' }}
            items={[
                { key: 'documentation', icon: <Icons.documentation />, label: 'Документация', onClick: () => openInBrowserTab('/docs/') },
                { key: 'modules-graph', icon: <Icons.modulesGraph />, label: 'Граф модулей', onClick: () => openInBrowserTab('/modules-graph') },
                { key: 'logout', icon: <Icons.signOut />, label: 'Выйти', disabled: isPending, onClick: confirmLogout },
            ]}
        />
    );
}
