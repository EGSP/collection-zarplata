import { useOverflowShadows } from '../sdk/ds/overflow-shadows';
import { useLogout } from '@refinedev/core';
import { App, Button, ConfigProvider, Divider, Drawer, Flex, Layout, Menu, Result, theme, Tooltip, Typography } from 'antd';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ShellSubsystem } from '../../server/ui/descriptions';
import { Pending } from '../common/pending';
import { useMetadata } from '../data-provider/metadata';
import { Icons } from '../sdk/ds/icons';
import { ApplicationVersionsText } from './application-versions';
import { TabPages } from '../tabs/tab-pages';
import { TabStrip } from '../tabs/tab-strip';
import { useWindowTabs } from '../tabs/window-tabs';
import { navigationWidths, useNavigationStrategy } from './navigation-strategies';
import { SubsystemDialog, SubsystemMenu, useSubsystemItems } from './subsystems';
import { WorkplaceMenu, useWorkplaceItems } from './workplaces';

/**
 * Раскладка приложения: слева боковая панель, справа полоса вкладок и страница активной вкладки.
 * В панели сверху вниз стоят кнопка Switcher, рабочие места, подсистемы и служебные пункты:
 * документация, граф модулей и выход.
 *
 * Панель адаптивна, как в Carbon UI Shell. Как она показывается и что делает Switcher, решает
 * стратегия для точки перелома окна (`navigation-strategies.ts`): начиная с `max` панель сдвигает
 * страницу (push), с `md` выдвигается поверх неё (overlay), на `sm` стоит под страницей. Точку окна раскладка
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
    const bottom = presentation.docked === 'bottom';
    return (
        <Layout style={{ height: '100dvh', flexDirection: bottom ? 'column' : 'row' }}>
            {/* Свёрнутое меню Ant Design по умолчанию шире полосы (80 px), поэтому его ширина выровнена по панели. */}
            {!bottom && <ConfigProvider theme={{ components: { Menu: { collapsedWidth: navigationWidths.rail } } }}>
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
            </ConfigProvider>}
            {/* Drawer закрывается по Esc и нажатию на затемнение; панель внутри него та же, только развёрнутая. */}
            {!bottom && <Drawer
                open={presentation.overlay}
                placement="left"
                size={navigationWidths.expanded}
                closable={false}
                onClose={collapse}
                styles={{ body: { padding: 0 } }}
            >
                <NavigationPanel
                    collapsed={false}
                    showVersions={!bottom}
                    switcherTitle={strategy.switcherTitle(expanded)}
                    onSwitch={collapse}
                    onNavigate={afterNavigation}
                    onOpenSubsystem={openSubsystem}
                />
            </Drawer>}
            {openedSubsystem === null ? null : <SubsystemDialog subsystem={openedSubsystem} onClose={() => setOpenedSubsystem(null)} />}
            {/* Без нулевой наименьшей ширины длинная полоса вкладок растянула бы область шире окна. */}
            <Layout.Content style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                <TabStrip />
                {/* Прокручивается страница вкладки, а не вся область: полоса вкладок остаётся на месте. */}
                <div style={{ flex: 1, minHeight: 0 }}>
                    <PageContent />
                </div>
                {/* Мобильное меню занимает только область страницы: бар остаётся отдельным
                    интерактивным соседом, без маски, блокировки прокрутки окна и ловушки фокуса. */}
                {bottom && expanded && <section aria-label="Развёрнутое меню" className="mobile-navigation-panel" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); collapse(); } }} style={{ position: 'absolute', inset: 0, zIndex: 10, background: token.colorBgContainer }}>
                    <style>{`
                        @keyframes mobile-navigation-enter { from { transform: translateY(100%); } to { transform: translateY(0); } }
                        .mobile-navigation-panel { animation: mobile-navigation-enter 180ms ease-out; }
                        @media (prefers-reduced-motion: reduce) { .mobile-navigation-panel { animation: none; } }
                    `}</style>
                    <ConfigProvider theme={{ token: { fontSize: 16 }, components: { Menu: { itemHeight: 64, iconSize: 24 } } }}>
                        <NavigationPanel collapsed={false} showHeader={false} showVersions={false} switcherTitle={strategy.switcherTitle(expanded)} onSwitch={collapse} onNavigate={afterNavigation} onOpenSubsystem={openSubsystem} />
                    </ConfigProvider>
                </section>}
            </Layout.Content>
            {bottom && <BottomNavigation onSwitch={() => setExpanded(!expanded)} switcherTitle={strategy.switcherTitle(expanded)} onNavigate={afterNavigation} onOpenSubsystem={openSubsystem} />}
        </Layout>
    );
}

/** Свойства содержимого боковой панели. */
interface NavigationPanelProperties {
    /** Панель свёрнута в полосу иконок: заголовки пунктов скрыты в подсказки. */
    readonly collapsed: boolean;
    /** В мобильном меню версии остаются только на странице входа. */
    readonly showVersions?: boolean;
    /** Мобильное меню открывается кнопкой бара и не повторяет её вместе с заголовком. */
    readonly showHeader?: boolean;
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
 * прокручиваются только подсистемы, а служебные пункты стоят внизу. Под ними выводятся версии;
 * в полосе иконок им негде поместиться, и они видны после разворачивания панели.
 */
function NavigationPanel({ collapsed, showVersions = true, showHeader = true, switcherTitle, onSwitch, onNavigate, onOpenSubsystem }: NavigationPanelProperties) {
    const { token } = theme.useToken();
    return (
        <Flex vertical style={{ height: '100%' }}>
            {showHeader && <><Flex align="center" gap={token.marginXS} justify={collapsed ? 'center' : 'flex-start'} style={{ padding: token.paddingXS }}>
                <Tooltip title={switcherTitle} placement="right">
                    <Button type="text" aria-label={switcherTitle} icon={<Icons.switcher />} onClick={onSwitch} />
                </Tooltip>
                {collapsed ? null : (
                    <Typography.Title level={5} ellipsis style={{ margin: 0 }}>
                        Учёт зарплаты и продаж
                    </Typography.Title>
                )}
            </Flex>
            <NavigationDivider /></>}
            <NavigationScrollArea axis="vertical">
                <WorkplaceSection onNavigate={onNavigate} />
                <SubsystemMenu onOpen={onOpenSubsystem} />
                <NavigationDivider />
                <ServiceMenu onNavigate={onNavigate} />
            </NavigationScrollArea>
            {collapsed || !showVersions ? null : (
                <div style={{ padding: token.paddingXS, textAlign: 'center' }}>
                    <ApplicationVersionsText />
                </div>
            )}
        </Flex>
    );
}

/** Единая толщина разделителей групп во всех вариантах навигации. */
function NavigationDivider({ vertical = false }: { readonly vertical?: boolean }) {
    const { token } = theme.useToken();
    return <Divider orientation={vertical ? 'vertical' : 'horizontal'} style={{
        flex: 'none',
        borderColor: token.colorBorder,
        ...(vertical ? { height: 40, margin: '12px 0', borderInlineStartWidth: 2 } : { margin: 0, borderBlockStartWidth: 2 }),
    }} />;
}

/** Рабочие места с разделителем под ними. Если рабочих мест нет, не выводится и разделитель. */
function WorkplaceSection({ onNavigate }: { readonly onNavigate: () => void }) {
    const hasWorkplaces = (useMetadata().data?.shell.workplaces.length ?? 0) > 0;
    if (!hasWorkplaces) return null;
    return (
        <>
            <WorkplaceMenu onNavigate={onNavigate} />
            <NavigationDivider />
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
function useServiceItems(onNavigate: () => void) {
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
    return [
        { key: 'documentation', icon: <Icons.documentation />, label: 'Документация', onClick: () => openInBrowserTab('/docs/') },
        { key: 'modules-graph', icon: <Icons.modulesGraph />, label: 'Граф модулей', onClick: () => openInBrowserTab('/modules-graph') },
        { key: 'logout', icon: <Icons.signOut />, label: 'Выйти', disabled: isPending, onClick: confirmLogout },
    ];
}

/** Служебные пункты боковой панели. */
function ServiceMenu({ onNavigate }: { readonly onNavigate: () => void }) {
    const items = useServiceItems(onNavigate);
    return <Menu mode="inline" selectable={false} style={{ borderInlineEnd: 'none' }} items={items} />;
}

/**
 * Область прокрутки навигации: общий хук таблицы определяет скрытые края по выбранной оси.
 * Сама рамка не прокручивается, поэтому тени остаются у границ видимой части.
 */
function NavigationScrollArea({ axis, children, selectedKey }: { readonly axis: 'horizontal' | 'vertical'; readonly children: ReactNode; readonly selectedKey?: string }) {
    const frame = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    useOverflowShadows(frame, scroller, axis);
    useLayoutEffect(() => {
        scroller.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [selectedKey]);
    return <div ref={frame} className="navigation-scroll" data-axis={axis} style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
        <style>{`
            .navigation-scroll-area { scrollbar-width: none; -ms-overflow-style: none; overscroll-behavior: contain; }
            .navigation-scroll-area::-webkit-scrollbar { display: none; }

        `}</style>
        <div ref={scroller} className="navigation-scroll-area" style={{ height: '100%', overflowX: axis === 'horizontal' ? 'auto' : 'hidden', overflowY: axis === 'vertical' ? 'auto' : 'hidden' }}>
            <div style={axis === 'horizontal' ? { display: 'flex', width: 'max-content', alignItems: 'center' } : undefined}>{children}</div>
        </div>
    </div>;
}

/** Нижний бар содержит только иконки; девять точек поднимают меню с подписями над баром. */
function BottomNavigation({ onNavigate, onOpenSubsystem, onSwitch, switcherTitle }: Pick<NavigationPanelProperties, 'onNavigate' | 'onOpenSubsystem' | 'onSwitch' | 'switcherTitle'>) {
    const { token } = theme.useToken();
    const workplaces = useWorkplaceItems(onNavigate);
    const subsystems = useSubsystemItems(onOpenSubsystem);
    const services = useServiceItems(onNavigate);
    const groups = [
        workplaces.items.map((item) => ({ ...item, key: `workplace:${item.key}`, selected: item.key === workplaces.pathname, onClick: () => workplaces.onSelect(item.key), disabled: false })),
        subsystems.map((item) => ({ ...item, key: `subsystem:${item.key}`, selected: false, disabled: false })),
        services.map((item) => ({ ...item, key: `service:${item.key}`, selected: false, disabled: item.disabled === true })),
    ].filter((group) => group.length > 0);
    return <nav aria-label="Основная навигация" className="bottom-navigation" style={{ display: 'flex', flex: 'none', paddingBottom: 'env(safe-area-inset-bottom)', background: token.colorBgContainer, borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        <style>{`.bottom-navigation button.ant-btn { flex: none; width: 64px; min-width: 64px; height: 64px; padding: 0; font-size: 24px; } .bottom-navigation .navigation-group { display: flex; }`}</style>
        {/* Switcher закреплён первым и доступен при любом положении горизонтальной прокрутки. */}
        <Button type="text" aria-label={switcherTitle} icon={<Icons.switcher />} onClick={onSwitch} />
        <NavigationDivider vertical />
        <NavigationScrollArea axis="horizontal" selectedKey={workplaces.pathname}>
            {groups.map((group, index) => <div className="navigation-group" key={group[0]!.key}>
                {index > 0 && <NavigationDivider vertical />}
                {group.map((item) => <Button key={item.key} type="text" aria-label={item.label} icon={item.icon} disabled={item.disabled} aria-current={item.selected ? 'page' : undefined} onClick={item.onClick} style={{ color: item.selected ? token.colorPrimary : token.colorText, background: item.selected ? token.controlItemBgActive : undefined }} />)}
            </div>)}
        </NavigationScrollArea>
    </nav>;
}
