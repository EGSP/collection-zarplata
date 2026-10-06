import { randomBytes } from 'node:crypto';

/**
 * Создаёт UUIDv7: первые шесть байт содержат время, остальные заполняются случайными байтами.
 * Версия и вариант задаются отдельно, чтобы идентификаторы оставались совместимыми с UUID.
 */
export function newGuid(): string {
    const bytes = randomBytes(16);
    const time = Date.now();
    for (let index = 5; index >= 0; index--) bytes[index] = Math.floor(time / 2 ** ((5 - index) * 8)) & 255;
    bytes[6] = (bytes[6]! & 15) | 0x70;
    bytes[8] = (bytes[8]! & 63) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Формат guid в запросах: проверяется до обращения к базе, чтобы ошибка ввода давала 400, а не пустой результат. */
export const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
