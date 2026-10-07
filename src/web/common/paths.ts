/**
 * Адреса страниц объектов конфигурации.
 *
 * У объекта три адреса: список, форма новой записи и форма существующей записи. Адреса строятся
 * только здесь, поэтому ссылки из списков, форм и полей ссылок не расходятся с маршрутами приложения.
 */
import type { PerformTarget } from '../data-provider/perform';

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

/**
 * Состояние перехода, которое список передаёт форме: адрес списка вместе с сортировкой, отбором
 * и страницей. По нему кнопка «Закрыть» возвращает пользователя в тот же список. У формы,
 * открытой по ссылке или по сохранённому адресу, такого состояния нет.
 */
export interface ListLocationState {
    readonly list: string;
}

/** Адрес списка, из которого открыта форма, либо `null`, если форма открыта не из списка. */
export function listLocation(state: unknown): string | null {
    if (typeof state !== 'object' || state === null || !('list' in state)) return null;
    return typeof state.list === 'string' ? state.list : null;
}
