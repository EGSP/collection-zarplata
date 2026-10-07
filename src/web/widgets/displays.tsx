/**
 * Компоненты отображения простых видов: значение выводится текстом там, где его нельзя изменить,
 * то есть в ячейке списка и на форме у полей только для чтения. Отображение ссылки и регистратора
 * лежит отдельно (`references/reference-display.tsx`). Незаполненное значение ничего не выводит.
 */
import { formatBoolean, formatDate, formatDateTime, formatMoney, formatNumber } from './format';
import type { DisplayProperties } from './widget';

/** Отображение строки и `guid`: значение выводится как есть. */
export function TextDisplay({ value }: DisplayProperties<string>) {
    return <>{value ?? ''}</>;
}

export function NumberDisplay({ value }: DisplayProperties<number>) {
    return <>{value === null || value === undefined ? '' : formatNumber(value)}</>;
}

/** Отображение суммы: копейки выводятся рублями с двумя знаками после запятой. */
export function MoneyDisplay({ value }: DisplayProperties<number>) {
    return <>{value === null || value === undefined ? '' : formatMoney(value)}</>;
}

export function DateDisplay({ value }: DisplayProperties<string>) {
    return <>{value === null || value === undefined ? '' : formatDate(value)}</>;
}

export function DateTimeDisplay({ value }: DisplayProperties<string>) {
    return <>{value === null || value === undefined ? '' : formatDateTime(value)}</>;
}

/** Отображение логического значения словами «Да» и «Нет». */
export function BooleanDisplay({ value }: DisplayProperties<boolean>) {
    return <>{value === null || value === undefined ? '' : formatBoolean(value)}</>;
}
