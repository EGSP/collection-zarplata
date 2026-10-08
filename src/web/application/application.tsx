import { Authenticated, Refine } from '@refinedev/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApplication, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { useMemo } from 'react';
import { BrowserRouter } from 'react-router';
import { createAuthenticationProvider } from '../authentication/authentication-provider';
import { LoginPage } from '../authentication/login-page';
import { Pending } from '../common/pending';
import { dataProvider } from '../data-provider/data-provider';
import { metadataQuery, useMetadata } from '../data-provider/metadata';
import { WindowTabsProvider } from '../tabs/window-tabs';
import { ApplicationLayout } from './layout';
import { i18nProvider, useNotificationProvider } from './notifications';
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
 * Тема Ant Design. Длительности анимаций вдвое короче стандартных 0,1, 0,2 и 0,3 секунды: при
 * стандартных подсветка под курсором и появление выпадающих списков и окон заметно отстают
 * от действия пользователя.
 *
 * Длительности заданы напрямую, а не через `motionUnit`: Ant Design округляет производные
 * значения до десятых долей секунды, и шаг 0,05 дал бы прежние 0,1 секунды.
 */
const theme = {
    token: {
        motionDurationFast: '0.05s',
        motionDurationMid: '0.1s',
        motionDurationSlow: '0.15s',
    },
};

/** Корень клиента: маршрутизатор, провайдеры Ant Design и запросов вокруг приложения Refine. */
export function Application() {
    return (
        <BrowserRouter>
            <ConfigProvider locale={ruRU} theme={theme} modal={{ mask: { closable: false } }}>
                <AntdApplication>
                    <QueryClientProvider client={queryClient}>
                        <RefineApplication />
                    </QueryClientProvider>
                </AntdApplication>
            </ConfigProvider>
        </BrowserRouter>
    );
}

/**
 * Приложение Refine. Ресурсы строятся из описаний объектов, поэтому до входа и во время загрузки
 * описаний их список пуст.
 *
 * Общих маршрутов у приложения нет: страницы по адресам раскладывает каждая вкладка для своего
 * адреса (`TabPages`), а набор вкладок выводится из адреса браузера (`WindowTabsProvider`).
 *
 * Всё приложение закрыто проверкой входа. Без сессии на его месте показывается экран входа,
 * а адрес не меняется. Поэтому после входа открывается та же страница, в том числе когда сессия
 * истекла посреди работы, и отдельный адрес экрана входа с адресом возврата не нужен. Вкладки
 * стоят под проверкой входа и при завершении сессии закрываются.
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
            <Authenticated key="application" fallback={<LoginPage />} loading={<Pending fullPage />}>
                <WindowTabsProvider>
                    <ApplicationLayout />
                </WindowTabsProvider>
            </Authenticated>
        </Refine>
    );
}
