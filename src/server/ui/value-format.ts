/**
 * Общий формат значений для описаний интерфейса: клиент показывает этот текст, а сервер
 * ищет в нём подстроку. Модуль не зависит от Nest и Effect и входит в обе сборки.
 * Дата со временем переводится в местный часовой пояс: при поиске это пояс сервера,
 * при отображении это пояс браузера на том же компьютере.
 */
import dayjs from 'dayjs';
import type { FieldKind } from '../metadata/descriptions.js';

/** Вид даты на экране, в том числе в поле выбора даты. */
export const dateFormat = 'DD.MM.YYYY';

/** Вид даты и времени на экране, в том числе в поле выбора даты и времени. */
export const dateTimeFormat = 'DD.MM.YYYY HH:mm';

/** Переводит календарную дату `YYYY-MM-DD` в `ДД.ММ.ГГГГ`. */
export function formatDate(value: string): string {
    return dayjs(value).format(dateFormat);
}

/** Переводит ISO 8601 с часовым поясом в `ДД.ММ.ГГГГ ЧЧ:ММ` по местному поясу. */
export function formatDateTime(value: string): string {
    return dayjs(value).format(dateTimeFormat);
}

/** Показывает конечное число с десятичной запятой и разделителями разрядов. */
export function formatNumber(value: number): string {
    return value.toLocaleString('ru-RU', { maximumFractionDigits: 20 });
}

/** Показывает целое число копеек рублями с запятой и двумя цифрами копеек. */
export function formatMoney(kopecks: number): string {
    return (kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Показывает логическое значение словами, общими для поиска и отображения. */
export function formatBoolean(value: boolean): string {
    return value ? 'Да' : 'Нет';
}

/**
 * Текст для поиска по виду поля. Незаполненное значение, другой тип значения
 * или вид поля без поиска по подстроке возвращает `null` и не считается совпадением.
 */
export function formatSearchValue(kind: FieldKind, value: unknown): string | null {
    switch (kind) {
        case 'string': return typeof value === 'string' ? value : null;
        case 'number': return typeof value === 'number' ? formatNumber(value) : null;
        case 'money': return typeof value === 'number' ? formatMoney(value) : null;
        case 'date': return typeof value === 'string' ? formatDate(value) : null;
        case 'dateTime': return typeof value === 'string' ? formatDateTime(value) : null;
        case 'boolean': return typeof value === 'boolean' ? formatBoolean(value) : null;
        default: return null;
    }
}

/**
 * Приводит текст значения и запрос к одному регистру и NFC, сохраняя буквальные `%` и `_`.
 * У чисел и денег убирает пробельные разделители разрядов, включая неразрывные пробелы.
 * В строках и датах пробелы сохраняются: например, между датой и временем.
 */
export function normalizeSearchText(kind: FieldKind, value: string): string {
    const text = value.normalize('NFC').toLowerCase();
    return kind === 'number' || kind === 'money' ? text.replace(/\s/gu, '') : text;
}
