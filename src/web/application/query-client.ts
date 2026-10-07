/**
 * Общий клиент TanStack Query и его связь с сессией.
 *
 * Клиент один на приложение: описания объектов загружаются выше компонента `<Refine>`, которому
 * нужны готовые ресурсы, а данные читают хуки Refine внутри него. Refine получает этот же клиент
 * и своих настроек по умолчанию к готовому клиенту не применяет, поэтому они заданы здесь.
 */
import { keys } from '@refinedev/core';
import { keepPreviousData, QueryClient } from '@tanstack/react-query';
import { sessionStatus } from '../authentication/session';
import { metadataQuery } from '../data-provider/metadata';

/** Клиент запросов приложения. Его же использует Refine. */
export const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            // Проверку входа Refine выполняет запросом и на время его повтора убирает страницу с экрана.
            // Повтор при возврате в окно или восстановлении сети сбрасывал бы открытую форму.
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            // Пока загружается следующая страница списка, на экране остаётся предыдущая.
            placeholderData: keepPreviousData,
            // Отказы сервера (нет права, неверные данные, запрет политики) от повтора не изменятся,
            // а повторы только задержали бы сообщение об ошибке.
            retry: false,
        },
    },
});

sessionStatus.subscribe((status) => {
    if (status === 'ended') {
        // Данные и описания принадлежат пользователю завершённой сессии: следующий вошедший не должен
        // их увидеть. `resetQueries` здесь не подходит: он тут же запросил бы их заново, потому что
        // компоненты ещё не узнали о завершении сессии, и сервер ответил бы отказом на каждый запрос.
        queryClient.removeQueries({ queryKey: keys().data().get() });
        queryClient.getQueryCache().find({ queryKey: metadataQuery.queryKey })?.reset();
    }
    // О смене состояния Refine сам не узнаёт: проверку входа нужно повторить, чтобы он открыл
    // приложение после входа или экран входа после завершения сессии.
    void queryClient.invalidateQueries({ queryKey: keys().auth().get() });
});
