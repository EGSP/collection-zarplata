/**
 * Уведомления Refine средствами Ant Design и их тексты на русском языке.
 *
 * Хуки данных Refine сами сообщают об исходе запроса, но без провайдера уведомлений сообщение
 * никуда не выводится, а встроенные заголовки написаны по-английски. Провайдер уведомлений
 * показывает сообщения компонентом Ant Design, i18n-провайдер подставляет русские заголовки.
 * Описанием ошибки служит текст сервера.
 */
import type { I18nProvider, NotificationProvider } from '@refinedev/core';
import { App } from 'antd';
import { useMemo } from 'react';

/**
 * Провайдер уведомлений для `<Refine>`. Это хук: уведомления Ant Design берутся из контекста
 * компонента `App`, чтобы они получали тему и язык приложения.
 */
export function useNotificationProvider(): NotificationProvider {
    const { notification } = App.useApp();
    return useMemo(
        () => ({
            open: ({ key, type, message, description }) => {
                // Вид `progress` Refine присылает только в режиме отменяемых изменений, который приложение не включает.
                if (type === 'progress') return;
                notification[type]({ ...(key === undefined ? {} : { key }), title: message, description });
            },
            close: (key) => notification.destroy(key),
        }),
        [notification],
    );
}

/** Заголовки уведомлений, которые хуки данных Refine показывают сами. */
const messages: { readonly [key: string]: string } = {
    'notifications.success': 'Готово',
    'notifications.error': 'Ошибка',
    'notifications.createSuccess': 'Запись создана',
    'notifications.createError': 'Не удалось создать запись',
    'notifications.editSuccess': 'Запись сохранена',
    'notifications.editError': 'Не удалось сохранить запись',
    'notifications.deleteSuccess': 'Запись помечена на удаление',
    'notifications.deleteError': 'Не удалось пометить запись на удаление',
};

/** Переводит встроенные тексты Refine. Язык в приложении один, поэтому смена языка ничего не делает. */
export const i18nProvider: I18nProvider = {
    // Refine вызывает перевод и с двумя аргументами: тогда текст по умолчанию приходит вторым.
    translate: (key: string, options?: unknown, defaultMessage?: string) =>
        messages[key] ?? defaultMessage ?? (typeof options === 'string' ? options : key),
    changeLocale: () => undefined,
    getLocale: () => 'ru',
};
