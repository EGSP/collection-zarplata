/**
 * Точка входа страницы графа модулей. Страница собирается вместе с клиентом приложения
 * и использует его тему, клиент API и библиотеки, но не оболочку: у неё свой каркас.
 */
import 'antd/dist/reset.css';
import '@xyflow/react/dist/style.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App as AntdApplication, ConfigProvider } from 'antd';
import ruRU from 'antd/locale/ru_RU';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Модуль сессии подключает к клиенту API обновление токенов: без него истёкший access-токен
// дал бы отказ, хотя refresh-токен ещё действует.
import '../authentication/session';
import { applicationTheme } from '../common/theme';
import { ModulesGraphPage } from './modules-graph-page';

/**
 * Собственный клиент запросов: общий клиент приложения связан с Refine и описаниями объектов,
 * которые этой странице не нужны. Повтор отказа сервера только задержал бы сообщение об ошибке.
 */
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });

const root = document.getElementById('root');
if (root === null) throw new Error('Не найден элемент #root');

createRoot(root).render(
    <StrictMode>
        <ConfigProvider locale={ruRU} theme={applicationTheme}>
            <AntdApplication>
                <QueryClientProvider client={queryClient}>
                    <ModulesGraphPage />
                </QueryClientProvider>
            </AntdApplication>
        </ConfigProvider>
    </StrictMode>,
);
