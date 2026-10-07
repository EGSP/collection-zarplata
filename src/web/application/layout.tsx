import { LogoutOutlined } from '@ant-design/icons';
import { useLogout, useMenu } from '@refinedev/core';
import { Button, Flex, Layout, Menu, Result, theme, Typography } from 'antd';
import { Link, Outlet } from 'react-router';
import { Pending } from '../common/pending';
import { useMetadata } from '../data-provider/metadata';

/**
 * Раскладка приложения: слева меню объектов и выход, справа содержимое открытой страницы.
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
                        <ObjectMenu />
                    </div>
                    <LogoutButton />
                </Flex>
            </Layout.Sider>
            <Layout.Content style={{ overflowY: 'auto', padding: token.paddingLG }}>
                <PageContent />
            </Layout.Content>
        </Layout>
    );
}

function PageContent() {
    const metadata = useMetadata();
    if (metadata.data !== undefined) return <Outlet />;
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
 * Меню объектов, доступных пользователю, по группам видов. Строится из ресурсов Refine, поэтому
 * пункт объекта остаётся выделенным на любой его странице.
 */
function ObjectMenu() {
    const { menuItems, selectedKey } = useMenu();
    return (
        <Menu
            mode="inline"
            selectedKeys={[selectedKey]}
            style={{ borderInlineEnd: 'none' }}
            items={menuItems.map((group) => ({
                type: 'group',
                key: group.key,
                label: group.label,
                children: group.children.flatMap((item) =>
                    item.route === undefined ? [] : [{ key: item.key, label: <Link to={item.route}>{item.label}</Link> }],
                ),
            }))}
        />
    );
}

function LogoutButton() {
    const { token } = theme.useToken();
    const { mutate: logout, isPending } = useLogout();
    return (
        <Button
            type="text"
            icon={<LogoutOutlined />}
            loading={isPending}
            onClick={() => logout()}
            style={{ margin: token.marginXS, justifyContent: 'flex-start' }}
        >
            Выйти
        </Button>
    );
}
