/**
 * Форматы строк ленты продаж и возвратов: общие у строки продажи, строки возврата и заголовков дней.
 * Файл `.tsx`: файлы `.ts` конфигурации считаются серверными, и клиент не импортирует их значения.
 */

/** Время документа: дата стоит в заголовке дня, поэтому в строке нужны только часы и минуты. */
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Короткая дата продажи-основания в строке возврата: «01.11.2026». */
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Полная дата заголовка дня: «среда, 4 ноября 2026 г.». */
const dayFormat = new Intl.DateTimeFormat('ru-RU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export function feedTime(value: string): string {
    return timeFormat.format(new Date(value));
}

export function feedDate(value: string): string {
    return dateFormat.format(new Date(value));
}

/** Ключ дня по местному времени: документы после полуночи относятся к следующему дню. */
export function feedDayKey(value: string): string {
    return new Date(value).toDateString();
}

/** Заголовок дня с заглавной буквы, как начало строки. */
export function feedDayTitle(value: string): string {
    const text = dayFormat.format(new Date(value));
    return text.charAt(0).toLocaleUpperCase('ru') + text.slice(1);
}

/**
 * Номер документа без ведущих нулей: «000123» читается как «123». Номер нужен, чтобы продавец
 * назвал документ покупателю или нашёл его в журнале. Номер без цифр в начале остаётся как есть.
 */
export function documentNumber(number: string): string {
    return number.replace(/^0+(?=\d)/u, '');
}

/** Перечень товаров «код: название» через запятую; у товара без кода только название. */
export function feedGoods(goods: ReadonlyArray<{ readonly code: string | null; readonly name: string }>): string {
    return goods.map((line) => (line.code === null ? line.name : `${line.code}: ${line.name}`)).join(', ');
}
