/**
 * Перевод значений из формата сервера в текст для человека.
 *
 * Функции собраны в одном месте, потому что один и тот же вид нужен в разных частях клиента:
 * в ячейке списка, в поле только для чтения, в представлении записи и в сообщении о границе числа.
 */
import dayjs from 'dayjs';

/** Вид даты на экране. Его же используют поля выбора даты. */
export const dateFormat = 'DD.MM.YYYY';

/** Вид даты и времени на экране. Его же используют поля выбора даты и времени. */
export const dateTimeFormat = 'DD.MM.YYYY HH:mm';

/** Дата `YYYY-MM-DD` в виде `ДД.ММ.ГГГГ`. */
export function formatDate(value: string): string {
    return dayjs(value).format(dateFormat);
}

/** Дата и время ISO 8601 в виде `ДД.ММ.ГГГГ ЧЧ:ММ` по часовому поясу браузера. */
export function formatDateTime(value: string): string {
    return dayjs(value).format(dateTimeFormat);
}

/** Число с разделителями разрядов, принятыми в русском языке. */
export function formatNumber(value: number): string {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 20 });
}

/** Сумма в копейках в виде рублей с двумя знаками после запятой. */
export function formatMoney(kopecks: number): string {
    return (kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
