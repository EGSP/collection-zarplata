/**
 * Разбор значений составного поля, общий для сервера и клиента.
 *
 * Значение несёт тип варианта, а описание поля перечисляет варианты. Хранение, поиск по показанному
 * тексту и виджеты выбирают вариант одинаково, поэтому правило выбора записано один раз. Модуль
 * не зависит от Nest и Effect и входит в обе сборки.
 */
import type { CompositeValue, FieldKind, ObjectReferenceValue, ObjectTarget } from './descriptions.js';

/** Что нужно знать о варианте, чтобы сопоставить его со значением: вид и цель ссылки. */
export interface CompositeVariant {
    readonly kind: FieldKind;
    readonly target: ObjectTarget | null;
}

/** Отличает значение составного поля от значений остальных видов и от непроверенных данных. */
export function isCompositeValue(value: unknown): value is CompositeValue {
    return typeof value === 'object' && value !== null && typeof (value as { readonly type?: unknown }).type === 'string';
}

/**
 * Находит вариант, которому принадлежит значение. Простой вариант определяется типом, ссылочный
 * ещё и целью: у поля может быть несколько ссылочных вариантов. Возвращает `undefined`, если
 * значение не подходит ни одному варианту, например после удаления варианта из конфигурации.
 */
export function compositeVariant<Variant extends CompositeVariant>(variants: ReadonlyArray<Variant> | null | undefined, value: CompositeValue): Variant | undefined {
    return variants?.find((variant) => variant.kind === value.type
        && (value.type !== 'reference' || (variant.target?.kind === value.kind && variant.target.name === value.name)));
}

/** Полная ссылка из значения ссылочного варианта; у простого варианта и пустого значения `null`. */
export function compositeReference(value: unknown): ObjectReferenceValue | null {
    return isCompositeValue(value) && value.type === 'reference' ? { kind: value.kind, name: value.name, guid: value.guid } : null;
}

/**
 * Упорядоченное сравнение (`<`, `>` и подобные) имеет смысл только внутри простого типа
 * с порядком значений: у ссылки и логического значения его нет.
 */
export function isOrderedCompositeValue(value: CompositeValue): boolean {
    return value.type !== 'reference' && value.type !== 'boolean';
}
