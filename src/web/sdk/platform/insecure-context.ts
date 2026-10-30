/**
 * Замены браузерных API, которые работают только на защищённой странице.
 *
 * Часть API браузер даёт только странице, открытой по https или с `localhost` и `127.0.0.1`
 * (`window.isSecureContext`). В магазине клиент открывают по http с адреса в сети, и там
 * таких API нет: `crypto.randomUUID` равен `undefined`, `navigator.clipboard` отсутствует.
 * При разработке страница открыта с `127.0.0.1`, поэтому ошибка видна только у магазина.
 *
 * Клиент вызывает такие API только через функции этого модуля. Когда понадобится ещё одно
 * API из списка «Secure context» на MDN, замену для него добавляют сюда.
 */

/**
 * Случайный UUID версии 4, как у `crypto.randomUUID`. Строится из `crypto.getRandomValues`:
 * в отличие от `randomUUID`, он доступен и на странице, открытой по http.
 */
export function randomUuid(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    // Биты версии (4) и варианта (10xx) по RFC 9562, как в `randomUUID`.
    bytes[6] = (bytes[6]! & 0x0f) | 0x40;
    bytes[8] = (bytes[8]! & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
