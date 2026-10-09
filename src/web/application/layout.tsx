import { useLogout } from '@refinedev/core';
import { App, Button, Flex, Layout, Result, theme, Typography } from 'antd';
import { Pending } from '../common/pending';
import { useMetadata } from '../data-provider/metadata';
import { Icons } from '../sdk/icons';
import { TabPages } from '../tabs/tab-pages';
import { TabStrip } from '../tabs/tab-strip';
import { useWindowTabs } from '../tabs/window-tabs';
import { SubsystemList } from './subsystems';

/**
 * Раскладка приложения: слева список подсистем, документация и выход, справа полоса вкладок и страница
 * активной вкладки.
 *
 * Страницы строятся по описаниям объектов, поэтому раскладка показывает их только после
 * загрузки описаний: странице не нужно самой обрабатывать ожидание и ошибку загрузки.
 */
export function ApplicationLayout() {
    const { token } = theme.useToken();
    return (
        <Layout style={{ height: '100vh' }}>
            <Layout.Sider theme="light" width={280} style={{ borderInlineEnd: `1px solid ${token.colorBorderSecondary}` }}>
                <Flex vertical style={{ height: '100%' }}>
                    <Typography.Title level={5} style={{ margin: 0, padding: token.padding }}>
                        Учёт зарплаты и продаж
                    </Typography.Title>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        <SubsystemList />
                    </div>
                    <DocumentationButton />
                    <LogoutButton />
                </Flex>
            </Layout.Sider>
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
 * Документация открывается в новой вкладке браузера, а не во вкладке приложения: у сайта своё
 * меню и оформление, внутри окна приложения они повторяли бы его каркас.
 */
function DocumentationButton() {
    const { token } = theme.useToken();
    return (
        <Button
            type="text"
            icon={<Icons.documentation />}
            href="/docs/"
            target="_blank"
            rel="noopener"
            style={{ marginInline: token.marginXS, marginBlockStart: token.marginXS, justifyContent: 'flex-start' }}
        >
            Документация
        </Button>
    );
}

/** Выход закрывает все вкладки, поэтому при несохранённых изменениях на любой из них спрашивает подтверждение. */
function LogoutButton() {
    const { token } = theme.useToken();
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
    return (
        <Button
            type="text"
            icon={<Icons.signOut />}
            loading={isPending}
            onClick={confirmLogout}
            style={{ margin: token.marginXS, justifyContent: 'flex-start' }}
        >
            Выйти
        </Button>
    );
}
