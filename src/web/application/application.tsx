import { Refine } from '@refinedev/core';
import routerProvider from '@refinedev/react-router';
import { App as AntdApplication, ConfigProvider, Layout, Typography } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { BrowserRouter, Route, Routes } from 'react-router';

export function Application() {
    return (
        <BrowserRouter>
            <ConfigProvider locale={ruRU}>
                <AntdApplication>
                    <Refine routerProvider={routerProvider}>
                        <Routes>
                            <Route index element={<HomePage />} />
                        </Routes>
                    </Refine>
                </AntdApplication>
            </ConfigProvider>
        </BrowserRouter>
    );
}

function HomePage() {
    return (
        <Layout style={{ minHeight: '100vh', padding: 24 }}>
            <Typography.Title level={3}>Учёт зарплаты и продаж</Typography.Title>
        </Layout>
    );
}
