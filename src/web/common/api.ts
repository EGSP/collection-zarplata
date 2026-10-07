/**
 * Клиент API сервера и единый вид ошибок запросов.
 *
 * Все запросы приложения идут через один экземпляр axios. О сессии этот модуль не знает: вход
 * подтверждают cookie, которые браузер прикладывает к запросу сам, а обновление токенов при
 * ответе 401 подключает к этому же экземпляру модуль сессии (`authentication/session.ts`).
 * Поэтому код, который вызывает `request`, истёкший access-токен не замечает.
 */
import axios, { type AxiosError, type AxiosRequestConfig } from 'axios';

/** Общее начало адресов API. */
export const apiPath = '/api';

/**
 * Экземпляр axios для запросов приложения. Адреса запросов задаются относительно `apiPath`.
 * Через него идут только запросы, требующие входа: по их ответам модуль сессии судит о её состоянии.
 */
export const api = axios.create({ baseURL: apiPath });

/**
 * Неуспешный запрос к API. Текст ошибки приходит с сервера на русском языке и показывается
 * пользователю без изменений.
 */
export class ApiError extends Error {
    constructor(
        /** Статус HTTP. Равен 0, если ответ не получен: сервер недоступен или соединение прервано. */
        readonly statusCode: number,
        message: string,
        /** Пути полей с ошибками проверки из ответа 400 единого эндпоинта, например `payload.fields.name`. */
        readonly fields: ReadonlyArray<string> = [],
        /** Ключ недостающего права из ответа 403 единого эндпоинта, например `catalog.sample.write`. */
        readonly right: string | null = null,
    ) {
        super(message);
    }
}

/**
 * Выполняет запрос приложения и возвращает тело ответа. Неуспех завершается `ApiError`:
 * ответ со статусом ошибки — с этим статусом и текстом сервера, отсутствие ответа — со статусом 0.
 */
export async function request<Result>(configuration: AxiosRequestConfig): Promise<Result> {
    try {
        const response = await api.request<Result>(configuration);
        return response.data;
    } catch (error) {
        throw axios.isAxiosError(error) ? apiError(error) : error;
    }
}

/** Переводит ошибку axios в `ApiError`. */
export function apiError(error: AxiosError): ApiError {
    if (error.response === undefined) return new ApiError(0, 'Нет связи с сервером');
    const statusCode = error.response.status;
    const body: unknown = error.response.data;
    const { message, error: text, fields, right } = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>;
    return new ApiError(
        statusCode,
        errorMessage(statusCode, message, text),
        Array.isArray(fields) ? fields.filter((field) => typeof field === 'string') : [],
        typeof right === 'string' ? right : null,
    );
}

/**
 * Текст ошибки из тела ответа. Единый эндпоинт кладёт его в `error`. Остальные маршруты отвечают
 * в формате Nest: текст в `message`, а в `error` — английское название статуса. У необработанной
 * ошибки Nest текст тоже английский («Internal server error»), поэтому для статусов 5xx он
 * заменяется общим.
 */
function errorMessage(statusCode: number, message: unknown, error: unknown): string {
    if (typeof message === 'string' && statusCode < 500) return message;
    if (message === undefined && typeof error === 'string') return error;
    return statusCode >= 500 ? 'Ошибка сервера' : `Сервер отклонил запрос (код ${statusCode})`;
}
