/** Тексты сумм и документов в отказах политик и действий: в том же виде, что в интерфейсе. */
import { formatDate, formatMoney } from '../server/ui/value-format.js';

/** Сумма в копейках рублями со знаком валюты: «400,00 ₽». */
export function rubles(kopecks: number): string {
    return `${formatMoney(kopecks)} ₽`;
}

/** Номер и дата документа, как в его представлении: «№ 3 от 09.10.2026». */
export function numberAndDate(document: { readonly number: string; readonly date: string }): string {
    return `№ ${Number(document.number)} от ${formatDate(document.date)}`;
}
