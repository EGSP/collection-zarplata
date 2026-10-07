/**
 * Адреса страниц объектов конфигурации.
 *
 * У объекта три адреса: список, форма новой записи и форма существующей записи. Адреса строятся
 * только здесь, поэтому ссылки из списков, форм и полей ссылок не расходятся с маршрутами приложения.
 * Путь адреса определяет вкладку, в которой открывается страница.
 */
import type { PerformTarget } from '../data-provider/perform';

/** Адрес главного экрана. */
export const homePath = '/';

/** Последняя часть адреса формы новой записи. `guid` записи таким быть не может. */
export const newRecordSegment = 'new';

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
