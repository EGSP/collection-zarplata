/**
 * Auth provider Refine поверх сессии клиента.
 *
 * Провайдер не хранит собственного состояния: о входе он отвечает по состоянию сессии
 * (`session.ts`), которое меняют вход, выход и ответы сервера на запросы данных. Поэтому
 * истёкшую сессию обнаруживает любой запрос, а не только вызовы Refine.
 */
import type { AuthProvider } from '@refinedev/core';
import { login, logout, sessionStatus } from './session';

/**
 * Создаёт auth provider. `probeSession` выполняет любой запрос от имени пользователя
 * и завершается после ответа сервера, каким бы он ни был: при открытии приложения только так
 * можно узнать, действуют ли cookie, оставшиеся от прошлого сеанса.
 */
export function createAuthenticationProvider(probeSession: () => Promise<void>): AuthProvider {
    return {
        login: async ({ pin }: { readonly pin: string }) => {
            try {
                await login(pin);
                return { success: true };
            } catch (error) {
                return { success: false, error: { name: 'Не удалось войти', message: errorText(error) } };
            }
        },

        // Экран входа показывается на месте приложения. После явного выхода открывается главный экран:
        // следующим может войти другой пользователь, и страница предыдущего ему не нужна.
        logout: async () => {
            try {
                await logout();
                return { success: true, redirectTo: '/' };
            } catch (error) {
                return { success: false, error: { name: 'Не удалось выйти', message: errorText(error) } };
            }
        },

        // Refine вызывает проверку при каждой смене маршрута, поэтому запрос к серверу она делает,
        // только пока состояние неизвестно. Если проверка не получила ответа, пользователь считается
        // вошедшим: приложение покажет ошибку загрузки, а не экран входа, который ничего не объяснит.
        check: async () => {
            if (sessionStatus.state === 'unknown') await probeSession();
            return { authenticated: sessionStatus.state !== 'ended' };
        },

        // Ответ 401 на запрос данных уже завершил сессию в перехватчике клиента API, отдельная реакция не нужна.
        onError: async () => ({}),
    };
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
