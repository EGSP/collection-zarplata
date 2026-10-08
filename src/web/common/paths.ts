/**
 * Адреса страниц объектов и собственных страниц конфигурации.
 *
 * У объекта три адреса: список, форма новой записи и форма существующей записи. У страницы
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
export function recordPath(target: PerformTarget, guid: string): string {
    return `${objectPath(target)}/${guid}`;
}

/** Адрес формы новой записи: `/catalog/sample/new`. */
export function newRecordPath(target: PerformTarget): string {
    return `${objectPath(target)}/${newRecordSegment}`;
}
