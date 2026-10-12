/**
 * Текст составного значения: названия типов и перевод между введённым текстом и значением.
 *
 * Единое поле ввода принимает значение текстом, а один и тот же текст может подходить нескольким
 * вариантам: «100» является и строкой, и числом. Правило выбора записано здесь один раз
 * и не зависит от разметки поля.
 */
import type { CompositeType, CompositeValue, ObjectTarget } from '../../server/metadata/descriptions';
import type { MetadataResponse } from '../../server/ui/descriptions';
import { findObjectView } from '../data-provider/metadata';
import { noAccessText } from '../references/presentation';
import { formatMoney } from './format';
import type { WidgetField } from './widget';

/** Названия простых типов значения. Ссылочный вариант называется заголовком своего объекта. */
const scalarTypeTitles: { readonly [Type in Exclude<CompositeType, 'reference'>]: string } = {
    string: 'Строка',
    number: 'Число',
    money: 'Сумма',
    date: 'Дата',
    dateTime: 'Дата и время',
    boolean: 'Да или нет',
};

/**
 * Название типа значения для пользователя: по нему он видит, чем считается введённое значение.
 * Принимает вариант поля или значение: у обоих есть вид и, для ссылки, цель. Объект без права
 * чтения называется «Нет доступа»: его заголовка в описаниях нет.
 */
export function compositeTypeTitle(metadata: MetadataResponse | undefined, kind: string, target: ObjectTarget | null): string {
    if (kind === 'reference') return findObjectView(metadata, target)?.title ?? noAccessText;
    return scalarTypeTitles[kind as Exclude<CompositeType, 'reference'>] ?? kind;
}

/**
 * Разбирает число, набранное пользователем: десятичная запятая или точка, пробелы между разрядами
 * допустимы. Возвращает `null`, если текст не является конечным числом или в нём больше
 * `fractionDigits` знаков после запятой.
 */
function parseNumber(text: string, fractionDigits: number | null): number | null {
    const normalized = text.replace(/\s/gu, '').replace(',', '.');
    const match = /^-?\d+(?:\.(\d+))?$/.exec(normalized);
    if (match === null || (fractionDigits !== null && (match[1]?.length ?? 0) > fractionDigits)) return null;
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
}

/** Порядок, в котором текст примеряется к простым вариантам: строка всегда приоритетнее числа. */
const textTypes = ['string', 'number', 'money'] as const;

/**
 * Значения, которыми может быть введённый текст, в порядке приоритета: строка, число, сумма.
 * Строка принимает любой текст; подходит ли он под её ограничения, решает проверка поля, а не разбор.
 * Число и сумма принимают только текст, который читается как число: у целого числа без дробной
 * части, у суммы не больше двух знаков копеек. Пустой текст значением не является.
 */
export function textInterpretations(variants: ReadonlyArray<WidgetField>, text: string): Array<CompositeValue> {
    const entered = text.trim();
    if (entered === '') return [];
    return textTypes.flatMap((type): Array<CompositeValue> => {
        const variant = variants.find((candidate) => candidate.kind === type);
        if (variant === undefined) return [];
        if (type === 'string') return [{ type, value: text }];
        if (type === 'number') {
            const value = parseNumber(entered, variant.rules?.integer === true ? 0 : null);
            return value === null ? [] : [{ type, value }];
        }
        const roubles = parseNumber(entered, 2);
        // Рубли в двоичном виде неточны, поэтому копейки округляются: 19,99 × 100 дало бы 1998,9999999999998.
        return roubles === null ? [] : [{ type, value: Math.round(roubles * 100) }];
    });
}

/**
 * Значение, которым текст становится без явного выбора пользователя. Пока текст подходит типу
 * текущего значения, тип сохраняется: правка числа 100 в 1005 не должна превращать его в строку.
 * Иначе берётся первое толкование по приоритету. Без подходящего толкования возвращает `undefined`.
 */
export function defaultInterpretation(interpretations: ReadonlyArray<CompositeValue>, current: CompositeValue | null | undefined): CompositeValue | undefined {
    return interpretations.find((candidate) => candidate.type === current?.type) ?? interpretations[0];
}

/**
 * Текст простого значения в том виде, в каком его удобно править: число с десятичной запятой
 * без разделителей разрядов, сумма в рублях с копейками. У ссылки текста здесь нет: её показывает
 * представление записи.
 */
export function editableText(value: CompositeValue): string {
    if (value.type === 'reference') return '';
    if (value.type === 'money') return (value.value / 100).toFixed(2).replace('.', ',');
    return typeof value.value === 'number' ? String(value.value).replace('.', ',') : String(value.value);
}

/** Текст простого значения в подсказке: так же, как его покажет список. */
export function displayedText(value: CompositeValue): string {
    if (value.type === 'money') return formatMoney(value.value);
    return editableText(value);
}
