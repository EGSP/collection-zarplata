import { Authenticated, Refine } from '@refinedev/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApplication, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useMemo } from 'react';
import { createBrowserRouter, Route, RouterProvider, Routes } from 'react-router';
import { createAuthenticationProvider } from '../authentication/authentication-provider';
import { LoginPage } from '../authentication/login-page';
import { NotFoundPage } from '../common/not-found';
import { Pending } from '../common/pending';
import { dataProvider } from '../data-provider/data-provider';
import { metadataQuery, useMetadata } from '../data-provider/metadata';
import { RecordPage } from '../forms/record-page';
import { ApplicationLayout } from './layout';
import { i18nProvider, useNotificationProvider } from './notifications';
import { ObjectPage, StartPage } from './pages';
import { queryClient } from './query-client';
import { objectResources } from './resources';
import { applicationRouterProvider } from './router-provider';

// При открытии приложения действие cookie проверяется загрузкой описаний объектов: они всё равно
// нужны сразу после входа, а отдельного запроса «кто я» у сервера нет.
const authenticationProvider = createAuthenticationProvider(() =>
    queryClient.ensureQueryData(metadataQuery).then(
        () => undefined,
        () => undefined,
    ),
);

const refineOptions = {
    // Refine по умолчанию отправляет сведения об использовании на свой сервер.
    disableTelemetry: true,
    reactQuery: { clientConfig: queryClient },
};

/**
 * Маршрутизатор приложения. Нужен именно маршрутизатор с данными: только он умеет остановить
 * переход, а форме это нужно, чтобы спросить подтверждение при несохранённых изменениях.
 * Маршрут у него один на все адреса, а страницы по адресам раскладывает `RefineApplication`:
 * маршруты страниц должны лежать внутри `<Refine>`.
 */
const router = createBrowserRouter([{ path: '*', element: <Providers /> }]);

/** Корень клиента. */
export function Application() {
    return <RouterProvider router={router} />;
}

/** Провайдеры Ant Design и запросов вокруг приложения Refine. */
function Providers() {
    return (
        <ConfigProvider locale={ruRU} modal={{ mask: { closable: false } }}>
            <AntdApplication>
                <QueryClientProvider client={queryClient}>
                    <RefineApplication />
                </QueryClientProvider>
            </AntdApplication>
        </ConfigProvider>
    );
}

/**
 * Приложение Refine и его маршруты. Ресурсы строятся из описаний объектов, поэтому до входа
 * и во время загрузки описаний их список пуст.
 *
 * Все страницы закрыты проверкой входа. Без сессии на месте страницы показывается экран входа,
 * а адрес не меняется. Поэтому после входа открывается та же страница, в том числе когда сессия
 * истекла посреди работы, и отдельный адрес экрана входа с адресом возврата не нужен.
 */
function RefineApplication() {
    const metadata = useMetadata();
    const resources = useMemo(() => objectResources(metadata.data?.objects ?? []), [metadata.data]);
    return (
        <Refine
            routerProvider={applicationRouterProvider}
            dataProvider={dataProvider}
            authProvider={authenticationProvider}
            notificationProvider={useNotificationProvider}
            i18nProvider={i18nProvider}
            resources={resources}
            options={refineOptions}
        >
            <Routes>
                <Route
                    element={
                        <Authenticated key="application" fallback={<LoginPage />} loading={<Pending fullPage />}>
                            <ApplicationLayout />
                        </Authenticated>
                    }
                >
                    <Route index element={<StartPage />} />
                    <Route path=":kind/:name" element={<ObjectPage />} />
                    <Route path=":kind/:name/:guid" element={<RecordPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                </Route>
            </Routes>
        </Refine>
    );
}
