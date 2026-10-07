/**
 * Сессия пользователя на клиенте: вход, выход и обновление токенов.
 *
 * Токены лежат в cookie с флагом `HttpOnly`, поэтому клиент не может ни прочитать их, ни узнать
 * срок действия. О сессии он судит только по ответам сервера: 401 означает, что access-токен
 * не принят. Такой ответ принимает перехватчик клиента API: он обновляет токены и повторяет
 * запрос, а вызывающий код получает уже ответ повтора. Поэтому истёкший access-токен не виден
 * ни запросам TanStack Query, ни интерфейсу. Сессия считается завершённой, только если 401
 * вернул и повтор: до этого отказ мог относиться к токену, который уже заменён.
 *
 * Обновление токенов одно на всю страницу. Refresh-токен одноразовый, и при нескольких
 * одновременных обновлениях сервер принял бы только первое, а остальные запросы потеряли бы сессию.
 *
 * Состояние сессии — единственный источник сведений о входе для остального клиента: по нему
 * auth provider Refine отвечает, вошёл ли пользователь, а приложение решает, загружать ли данные.
 */
import { createStore } from '@tanstack/react-store';
import axios, { type AxiosError } from 'axios';
import { api, apiError, apiPath } from '../common/api';

declare module 'axios' {
    interface AxiosRequestConfig {
        /** Номер пары токенов, с которой отправлен запрос. Заполняет перехватчик сессии. */
        tokenGeneration?: number;
    }
}

/**
 * Что клиент знает о сессии:
 * - `unknown` — приложение только открыто, и ни один запрос ещё не показал, действуют ли cookie;
 * - `active` — сервер принял запрос от имени пользователя;
 * - `ended` — сервер отказал и после обновления токенов либо пользователь вышел.
 */
export type SessionStatus = 'unknown' | 'active' | 'ended';

/** Текущее состояние сессии. Меняют его только функции и перехватчики этого модуля. */
export const sessionStatus = createStore<SessionStatus>('unknown');

function setStatus(status: SessionStatus): void {
    // Подписчики перепроверяют вход и сбрасывают данные, поэтому повтор того же состояния им не сообщается.
    if (sessionStatus.state !== status) sessionStatus.setState(() => status);
}

/**
 * Клиент для запросов самой сессии и для повторов. Он работает без перехватчиков: иначе отказ
 * в обновлении токенов или в повторном запросе запускал бы обновление заново.
 */
const direct = axios.create({ baseURL: apiPath });

/**
 * Номер текущей пары токенов: растёт при каждом входе и обновлении. Запрос запоминает номер
 * при отправке. Если к приходу ответа 401 номер уже другой, токены успел заменить соседний
 * запрос, и нужно только повторить свой. Второе обновление отозвало бы токены, с которыми
 * соседние запросы уже повторяются.
 */
let tokenGeneration = 0;

/** Идущее обновление токенов. Одновременные запросы ждут его, а не начинают своё. */
let refreshing: Promise<void> | null = null;

function refreshTokens(): Promise<void> {
    refreshing ??= direct
        .post('/authentication/refresh')
        .then(() => {
            tokenGeneration++;
        })
        .finally(() => {
            refreshing = null;
        });
    return refreshing;
}

function isUnauthorized(error: unknown): error is AxiosError {
    return axios.isAxiosError(error) && error.response?.status === 401;
}

api.interceptors.request.use((configuration) => {
    configuration.tokenGeneration = tokenGeneration;
    return configuration;
});

api.interceptors.response.use(
    (response) => {
        // Успешный ответ подтверждает, что сессия действует: так приложение узнаёт о ней при открытии.
        setStatus('active');
        return response;
    },
    async (error: unknown) => {
        if (!isUnauthorized(error) || error.config === undefined) throw error;
        const sentWith = error.config.tokenGeneration;
        // Запрос без номера обновляет токены как обычно: лишнее обновление безопаснее пропущенного.
        if (sentWith === undefined || sentWith === tokenGeneration) {
            try {
                await refreshTokens();
            } catch (refreshError) {
                // Отказ в обновлении ещё не означает конец сессии: токены могла заменить соседняя вкладка,
                // у которой общие с этой cookie. Поэтому исход решает повтор запроса.
                if (!isUnauthorized(refreshError)) throw refreshError;
            }
        }
        try {
            const response = await direct.request(error.config);
            setStatus('active');
            return response;
        } catch (repeatError) {
            if (isUnauthorized(repeatError)) setStatus('ended');
            throw repeatError;
        }
    },
);

/**
 * Входит по PIN: сервер выдаёт cookie с токенами. Неверный PIN завершается `ApiError` со статусом
 * 401, блокировка после нескольких неудач — со статусом 429.
 */
export async function login(pin: string): Promise<void> {
    await sessionRequest('/authentication/login', { pin });
    tokenGeneration++;
    setStatus('active');
}

/**
 * Выходит: сервер отзывает refresh-токен и удаляет cookie. Если запрос не удался, сессия остаётся
 * как была: cookie с флагом `HttpOnly` клиент сам удалить не может, и сообщать о выходе было бы неверно.
 */
export async function logout(): Promise<void> {
    await sessionRequest('/authentication/logout');
    setStatus('ended');
}

async function sessionRequest(path: string, body?: unknown): Promise<void> {
    try {
        await direct.post(path, body);
    } catch (error) {
        throw axios.isAxiosError(error) ? apiError(error) : error;
    }
}
