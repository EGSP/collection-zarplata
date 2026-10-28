/**
 * Типы данных ячеек таблицы. Колонка сообщает таблице тип своих значений, а таблица сама
 * решает, как их показать и как в них вводить: выравнивание, размер колонки, формат значения,
 * цифры одной ширины и правила ввода текстом. Поэтому сумма выглядит одинаково в табличной
 * части формы, в списке записей и в отчёте, и ни одна таблица не повторяет эти правила.
 *
 * ```ts
 * { key: 'total', title: 'Итог', type: 'money', value: (row) => row.total }   // 150057 → «1 500,57» справа
 * { key: 'state', title: 'Состояние', type: 'free', render: (row) => <State value={row.state} /> }
 * ```
 *
 * Типы примитивные: строка, число, сумма (в копейках), дата, дата и время, логическое значение.
 * Всё остальное — свободный тип `free`: его ячейку рисует сама колонка, например ссылку на запись.
 *
 * Строку, число и сумму ячейка редактирует собственным полем (`CellTextInput`): обычный `input`
 * занимает ячейку целиком и несёт её отступ. Поле хранит набранный текст, а наружу отдаёт
 * значение в формате сервера; символ, который не может стоять в значении, не набирается:
 *
 * ```text
 * Сумма: набрать «1500,5»   → значение 150050
 * Число с integer           → «12,» не набирается
 * Строка: стереть весь текст → значение null
 * ```
 */
import { useImperativeHandle, useRef, useState, type Ref } from 'react';
import { formatBoolean, formatDate, formatDateTime, formatMoney, formatNumber } from '../../widgets/format';
import type { ColumnSize } from './table-layout';

/** Тип данных колонки. `free` — ячейку рисует колонка, таблица её содержимое не трогает. */
export type CellType = 'string' | 'number' | 'money' | 'date' | 'dateTime' | 'boolean' | 'free';

/** Примитивный тип: таблица сама форматирует его значения. */
export type PrimitiveCellType = Exclude<CellType, 'free'>;

/** Ограничения ввода, которые колонка добавляет к правилам своего типа. */
export interface CellInputOptions {
    /** Только целые числа: дробная часть не набирается. Для `number`. */
    readonly integer?: boolean | undefined;
    /** Наибольшая длина строки в знаках. Для `string`. */
    readonly maximumLength?: number | null | undefined;
}

/** Перевод значения в текст поля и обратно. */
export interface TextConversion {
    readonly format: (value: unknown) => string;
    /** Может ли текст стоять в поле. Недопустимый ввод отбрасывается до изменения поля. */
    readonly accepts: (text: string) => boolean;
    /** Значение для формы; `undefined` — текст ещё не складывается в значение, форма не меняется. */
    readonly parse: (text: string) => unknown;
    readonly inputMode: 'text' | 'numeric' | 'decimal';
    /** Пробелы разрядов при вставке суммы из другого места отбрасываются. */
    readonly numeric: boolean;
}

/** Правила типа: как его значения стоят в ячейке и как их вводить. */
interface CellTypeRules {
    readonly align: 'start' | 'end' | 'center';
    /** Размер колонки по умолчанию. Минимум рассчитан и на показ, и на поле ввода. */
    readonly size: ColumnSize;
    /** Текст значения в ячейке; незаполненное значение — пустая строка. */
    readonly display: (value: unknown) => string;
    /** Правила ввода текстом. Без них тип вводится не текстом, например флажком или календарём. */
    readonly text?: (options: CellInputOptions) => TextConversion;
}

/** Число в текст с запятой: так его видит пользователь в остальных полях. */
function decimalText(value: number): string {
    return String(value).replace('.', ',');
}

/** Текст с запятой или точкой в число; пустой текст — незаполненное значение. */
function decimalValue(text: string): number | null | undefined {
    if (text === '') return null;
    const number = Number(text.replace(',', '.'));
    return Number.isFinite(number) && !/^-?[.,]?$/u.test(text) ? number : undefined;
}

const stringText: TextConversion = {
    format: (value) => (typeof value === 'string' ? value : ''),
    accepts: () => true,
    parse: (text) => (text === '' ? null : text),
    inputMode: 'text',
    numeric: false,
};

const integerText: TextConversion = {
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    accepts: (text) => /^-?\d*$/u.test(text),
    parse: decimalValue,
    inputMode: 'numeric',
    numeric: true,
};

const numberText: TextConversion = {
    format: (value) => (typeof value === 'number' ? decimalText(value) : ''),
    accepts: (text) => /^-?\d*[.,]?\d*$/u.test(text),
    parse: decimalValue,
    inputMode: 'decimal',
    numeric: true,
};

/**
 * Сумма: пользователь вводит рубли с копейками через запятую, значение хранит копейки. Перевод
 * округляется: 19,99 × 100 в двоичной дроби дало бы 1998,9999999999998.
 */
const moneyText: TextConversion = {
    format: (value) => (typeof value === 'number' ? decimalText(value / 100) : ''),
    accepts: (text) => /^-?\d*[.,]?\d{0,2}$/u.test(text),
    parse: (text) => {
        const roubles = decimalValue(text);
        return roubles === null || roubles === undefined ? roubles : Math.round(roubles * 100);
    },
    inputMode: 'decimal',
    numeric: true,
};

/** Значение одного вида либо пустая строка: значения типа приходят без проверки. */
function when<Value>(guard: (value: unknown) => value is Value, format: (value: Value) => string): (value: unknown) => string {
    return (value) => (guard(value) ? format(value) : '');
}
const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean';

/**
 * Правила типов. Числа и суммы прижаты вправо, чтобы разряды стояли друг под другом, и набраны
 * цифрами одной ширины. Короткие значения (числа, даты, флажок) не растут: остаток ширины
 * получают строки.
 */
export const cellTypes: { readonly [Type in PrimitiveCellType]: CellTypeRules } = {
    string: { align: 'start', size: { minimum: 12, weight: 1 }, display: when(isString, (value) => value), text: () => stringText },
    number: { align: 'end', size: { minimum: 8 }, display: when(isNumber, formatNumber), text: (options) => (options.integer === true ? integerText : numberText) },
    // «1 234 567,89» — двенадцать знаков.
    money: { align: 'end', size: { minimum: 12 }, display: when(isNumber, formatMoney), text: () => moneyText },
    // «28.10.2026» и значок календаря в поле ввода.
    date: { align: 'start', size: { minimum: 13 }, display: when(isString, formatDate) },
    dateTime: { align: 'start', size: { minimum: 18 }, display: when(isString, formatDateTime) },
    boolean: { align: 'center', size: { minimum: 4 }, display: when(isBoolean, formatBoolean) },
};

/** Размер колонки свободного типа по умолчанию. */
const freeSize: ColumnSize = { minimum: 12, weight: 1 };

/**
 * Размер колонки: заданный колонкой либо размер её типа, но не уже самого длинного слова
 * заголовка. Заголовок переносится по словам, а слово не разрывается. Знак `ch` — ширина цифры
 * обычного начертания; заголовок набран полужирным, а буквы вроде «м» и «ш» шире цифры, поэтому
 * длина слова берётся с запасом в пятую часть.
 */
export function cellColumnSize(type: CellType, title: unknown, size: ColumnSize | undefined, list = false): ColumnSize {
    const typeSize = type === 'free' ? freeSize : cellTypes[type].size;
    const base = size ?? (list ? { ...typeSize, minimum: Math.max(typeSize.minimum, listCellMinimum) } : typeSize);
    if (typeof title !== 'string') return base;
    const word = Math.ceil(Math.max(0, ...title.split(/\s+/u).map((part) => part.length)) * 1.2);
    return { ...base, minimum: Math.max(base.minimum, word) };
}

/** Выравнивание значений типа в ячейке и заголовке. */
export function cellAlign(type: CellType): 'start' | 'end' | 'center' {
    return type === 'free' ? 'start' : cellTypes[type].align;
}

/** Текст значения для ячейки примитивного типа. */
export function formatCell(type: PrimitiveCellType, value: unknown): string {
    return cellTypes[type].display(value);
}

/**
 * Правила ввода типа текстом: перевод значения в текст, допустимые символы и разбор текста.
 * Нужны полям ячейки, которые строятся поверх своего поля, например подсказкам значений.
 */
export function cellTextRules(type: PrimitiveCellType, options: CellInputOptions = {}): TextConversion {
    return (cellTypes[type].text ?? (() => stringText))(options);
}

/**
 * Наименьшая ширина колонки, ячейка которой предлагает список: подсказки значений или выбор
 * из вариантов. В узкой колонке не читались бы ни набранное значение, ни сам список. Колонка
 * может задать свой размер, если ей нужно шире.
 */
export const listCellMinimum = 16;

/** Вводится ли тип текстом в собственном поле ячейки. */
export function hasTextInput(type: CellType): boolean {
    return type !== 'free' && cellTypes[type].text !== undefined;
}

/** Класс поля ввода ячейки; правила задаёт таблица. */
export const cellInputClass = 'data-table-input';

/** Управление полем ячейки: фокус с выделением всего текста или с кареткой в конце. */
export interface CellTextInputHandle {
    /** `selectAll` — ввод начат с символа: набранное заменяет прежнее значение, как в электронной таблице. */
    focus(selectAll: boolean): void;
}

/** Свойства поля ячейки. Значение в формате сервера. */
export interface CellTextInputProperties extends CellInputOptions {
    readonly type: PrimitiveCellType;
    readonly value?: unknown;
    readonly onChange?: ((value: unknown) => void) | undefined;
    readonly id?: string | undefined;
    /** Название поля для чтения с экрана: подписи у поля в ячейке нет, её роль играет заголовок колонки. */
    readonly label?: string | undefined;
    readonly ref?: Ref<CellTextInputHandle> | undefined;
}

/**
 * Собственное поле ячейки для типа, который вводится текстом. Текст живёт в поле, пока ячейка
 * редактируется: поле появляется при входе в редактирование и пропадает при выходе, поэтому
 * отдельно сверять текст со значением снаружи не нужно.
 */
export function CellTextInput({ type, value, onChange, id, label, ref, integer, maximumLength }: CellTextInputProperties) {
    const conversion = (cellTypes[type].text ?? (() => stringText))({ integer, maximumLength });
    const [text, setText] = useState(() => conversion.format(value));
    const input = useRef<HTMLInputElement>(null);
    useImperativeHandle(ref, () => ({
        focus: (selectAll) => {
            const element = input.current;
            if (element === null) return;
            element.focus();
            if (selectAll) element.select();
            else element.setSelectionRange(element.value.length, element.value.length);
        },
    }), []);
    return (
        <input
            ref={input}
            className={cellInputClass}
            {...(id === undefined ? {} : { id })}
            {...(label === undefined ? {} : { 'aria-label': label })}
            {...(type === 'string' && maximumLength != null ? { maxLength: maximumLength } : {})}
            autoComplete="off"
            inputMode={conversion.inputMode}
            value={text}
            onChange={(event) => {
                const next = conversion.numeric ? event.target.value.replace(/\s/gu, '') : event.target.value;
                if (!conversion.accepts(next)) return;
                setText(next);
                const parsed = conversion.parse(next);
                if (parsed !== undefined) onChange?.(parsed);
            }}
        />
    );
}
