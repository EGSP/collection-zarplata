/** Начальные значения по видам полей и переиспользуемые вычисления для схем конфигурации. */
import { Effect } from 'effect';
import type { FieldKind } from './descriptions.js';

/** Текущий момент в формате, который принимает поле даты и времени. */
const currentDateTime = () => new Date().toISOString();

/** Календарный день в локальном часовом поясе сервера, используемом в расчётах магазина. */
function today(): string {
    const date = new Date();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** Полный перечень стандартов. Правило получает обязательность поля, если от неё зависит результат. */
export const standardDefaults = {
    string: null,
    number: null,
    money: null,
    date: null,
    dateTime: (required: boolean) => required ? currentDateTime() : null,
    boolean: (required: boolean) => required ? false : null,
    reference: null,
    objectReference: null,
    composite: null,
    guid: null,
    recorder: null,
} satisfies Record<FieldKind, null | ((required: boolean) => string | boolean | null)>;

/** Вычисления запускаются заново при подготовке значений, включая необязательные поля. */
export const semanticDefaults = {
    currentDateTime: Effect.sync(currentDateTime),
    today: Effect.sync(today),
};

/** Значение для поля без явного переопределения. */
export function standardFieldDefault(kind: FieldKind, required: boolean): string | boolean | null {
    const rule = standardDefaults[kind];
    return rule === null ? null : rule(required);
}
