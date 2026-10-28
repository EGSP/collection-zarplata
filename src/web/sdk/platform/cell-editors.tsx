/**
 * Собственные поля ячейки табличной части для видов, которые вводятся текстом: строка, число
 * и сумма. Такое поле — обычный `input` без обёрток Ant Design: оно занимает ячейку целиком,
 * несёт её внутренний отступ и не рисует своей рамки. Поэтому при входе в редактирование текст
 * не сдвигается, а рамку фокуса рисует только ячейка.
 *
 * Виды, которым нужен список или календарь (ссылка, выбор из вариантов, подсказки значений,
 * дата, составное значение), остаются на виджетах реестра: выпадающие панели Ant Design
 * повторять незачем.
 *
 * Поле хранит набранный текст, а форме отдаёт значение в формате сервера, как виджеты реестра:
 * сумму в копейках, число — числом. Пока текст не складывается в число, например «-»,
 * значение формы не меняется. Символ, который не может стоять в значении, не набирается вовсе:
 * буква в сумме или дробная часть у целого числа.
 *
 * ```text
 * Сумма: набрать «1500,5»   → в форме 150050
 * Число с правилом integer  → «12,» не набирается
 * Строка: стереть весь текст → в форме null
 * ```
 */
import { useImperativeHandle, useRef, useState, type ComponentType, type Ref } from 'react';
import type { FormField } from '../../../server/ui/descriptions';
import { dataTableInputClass } from '../ds/data-table';

/** Управление полем ячейки: фокус с выделением всего текста или с кареткой в конце. */
export interface CellEditorHandle {
    /** `selectAll` — ввод начат с символа: набранное заменяет прежнее значение, как в электронной таблице. */
    focus(selectAll: boolean): void;
}

/** Свойства поля ячейки. Значение в формате сервера, как у виджетов реестра. */
export interface CellEditorProperties {
    readonly field: FormField;
    readonly value?: unknown;
    readonly onChange?: ((value: unknown) => void) | undefined;
    readonly id?: string | undefined;
    readonly ref?: Ref<CellEditorHandle> | undefined;
}

/** Перевод значения в текст поля и обратно. */
interface TextConversion {
    readonly format: (value: unknown) => string;
    /** Может ли текст стоять в поле. Недопустимый ввод отбрасывается до изменения поля. */
    readonly accepts: (text: string) => boolean;
    /** Значение для формы; `undefined` — текст ещё не складывается в значение, форма не меняется. */
    readonly parse: (text: string) => unknown;
    /** Подсказка экранной клавиатуре и браузеру, какие символы ожидаются. */
    readonly inputMode: 'text' | 'numeric' | 'decimal';
    /** Пробелы разрядов при вставке суммы из другого места отбрасываются. */
    readonly numeric: boolean;
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

const stringConversion: TextConversion = {
    format: (value) => (typeof value === 'string' ? value : ''),
    accepts: () => true,
    parse: (text) => (text === '' ? null : text),
    inputMode: 'text',
    numeric: false,
};

const integerConversion: TextConversion = {
    format: (value) => (typeof value === 'number' ? String(value) : ''),
    accepts: (text) => /^-?\d*$/u.test(text),
    parse: decimalValue,
    inputMode: 'numeric',
    numeric: true,
};

const numberConversion: TextConversion = {
    format: (value) => (typeof value === 'number' ? decimalText(value) : ''),
    accepts: (text) => /^-?\d*[.,]?\d*$/u.test(text),
    parse: decimalValue,
    inputMode: 'decimal',
    numeric: true,
};

/**
 * Сумма: пользователь вводит рубли с копейками через запятую, форма хранит копейки. Перевод
 * округляется: 19,99 × 100 в двоичной дроби дало бы 1998,9999999999998.
 */
const moneyConversion: TextConversion = {
    format: (value) => (typeof value === 'number' ? decimalText(value / 100) : ''),
    accepts: (text) => /^-?\d*[.,]?\d{0,2}$/u.test(text),
    parse: (text) => {
        const roubles = decimalValue(text);
        return roubles === null || roubles === undefined ? roubles : Math.round(roubles * 100);
    },
    inputMode: 'decimal',
    numeric: true,
};

/**
 * Собственное поле ячейки для поля либо `null`, если поле вводится виджетом реестра: у него
 * есть варианты выбора или подсказки, либо вид требует списка или календаря.
 */
export function cellEditor(field: FormField): ComponentType<CellEditorProperties> | null {
    if (field.suggestions != null || field.choices != null) return null;
    switch (field.kind) {
        case 'string':
            return StringCellEditor;
        case 'number':
            return field.rules.integer ? IntegerCellEditor : NumberCellEditor;
        case 'money':
            return MoneyCellEditor;
        default:
            return null;
    }
}

function StringCellEditor(properties: CellEditorProperties) {
    return <TextCellEditor {...properties} conversion={stringConversion} />;
}

function IntegerCellEditor(properties: CellEditorProperties) {
    return <TextCellEditor {...properties} conversion={integerConversion} />;
}

function NumberCellEditor(properties: CellEditorProperties) {
    return <TextCellEditor {...properties} conversion={numberConversion} />;
}

function MoneyCellEditor(properties: CellEditorProperties) {
    return <TextCellEditor {...properties} conversion={moneyConversion} />;
}

/**
 * Поле ячейки с текстом. Текст живёт в поле, пока ячейка редактируется: поле появляется при входе
 * в редактирование и пропадает при выходе, поэтому отдельно сверять текст со значением формы не нужно.
 */
function TextCellEditor({ field, value, onChange, id, ref, conversion }: CellEditorProperties & { readonly conversion: TextConversion }) {
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
    const maximumLength = field.rules.maximumLength;
    return (
        <input
            ref={input}
            className={dataTableInputClass}
            {...(id === undefined ? {} : { id })}
            {...(maximumLength === null ? {} : { maxLength: maximumLength })}
            aria-label={field.title}
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
