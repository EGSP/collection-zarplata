/**
 * Адреса страниц объектов и собственных страниц конфигурации.
 *
 * У объекта три адреса: список, форма новой записи и форма существующей записи. У формы новой
 * записи со значениями от открывшего её кода есть ещё адрес черновика. У страницы
 * конфигурации адрес один. Адреса строятся
 * только здесь, поэтому ссылки из списков, форм и полей ссылок не расходятся с маршрутами приложения.
 * Путь адреса определяет вкладку, в которой открывается страница.
 */
import type { PerformTarget } from '../data-provider/perform';

/** Адрес главного экрана. */
export const homePath = '/';

/** Последняя часть адреса формы новой записи. `guid` записи таким быть не может. */
export const newRecordSegment = 'new';

/**
 * Первая часть адреса страницы конфигурации. С видом объекта не совпадает, поэтому адрес страницы
 * отличим от адреса списка объекта.
 */
export const pageSegment = 'page';

/** Адрес страницы конфигурации по её имени: `/page/sampleWorkplace`. */
export function pagePath(name: string): string {
    return `/${pageSegment}/${name}`;
}

/** Адрес списка объекта: `/catalog/sample`. */
export function objectPath(target: PerformTarget): string {
    return `/${target.kind}/${target.name}`;
}

/** Адрес формы существующей записи: `/catalog/sample/<guid>`. */
export function recordPath(target: PerformTarget, guid: string, original = false): string {
    // Явный режим переживает повторную обработку маршрута и перезагрузку страницы.
    return `${objectPath(target)}/${guid}${original ? '?original=1' : ''}`;
}

/** Адрес формы новой записи: `/catalog/sample/new`. */
export function newRecordPath(target: PerformTarget): string {
    return `${objectPath(target)}/${newRecordSegment}`;
}

/**
 * Адрес формы новой записи с переданными значениями: `/document/sale/new/<ключ>`. Значения
 * хранятся в памяти клиента под ключом (`useOpenRecord`), а у каждого черновика свой адрес,
 * поэтому он открывается отдельной вкладкой рядом с обычной формой новой записи.
 */
export function newRecordDraftPath(target: PerformTarget, key: string): string {
    return `${newRecordPath(target)}/${key}`;
}
