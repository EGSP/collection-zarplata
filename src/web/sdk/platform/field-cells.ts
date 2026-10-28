/**
 * Тип ячейки по виду поля. Таблицы платформы строятся по описаниям с сервера, а вид поля уже
 * и есть тип данных: сумма, дата, число. Модуль переводит вид в тип ячейки дизайн-системы
 * (`cell-types.tsx`), и дальше показ и ввод значения определяет тип, одинаково во всех таблицах.
 *
 * Виды, которые не являются примитивными значениями (ссылка, составное значение, регистратор),
 * становятся свободным типом: их ячейку рисует виджет реестра. Размер таким колонкам задаётся
 * здесь, потому что у свободного типа своего размера нет.
 */
import type { FieldKind } from '../../../server/ui/descriptions';
import { listCellMinimum, type CellType } from '../ds/cell-types';
import type { ColumnSize } from '../ds/table-layout';

/** Виды полей, которые соответствуют примитивным типам ячеек. */
const primitiveKinds: { readonly [Kind in FieldKind]: CellType } = {
    string: 'string',
    number: 'number',
    money: 'money',
    date: 'date',
    dateTime: 'dateTime',
    boolean: 'boolean',
    // guid выводится строкой как есть.
    guid: 'string',
    reference: 'free',
    objectReference: 'free',
    composite: 'free',
    recorder: 'free',
};

/** Размеры колонок свободного типа по виду: ссылке нужны место под представление и кнопки подбора. */
const freeSizes: { readonly [Kind in FieldKind]?: ColumnSize } = {
    reference: { minimum: 18, weight: 2 },
    objectReference: { minimum: 18, weight: 2 },
    composite: { minimum: 18, weight: 2 },
    recorder: { minimum: 20, weight: 1 },
};

/** Что нужно знать о поле для колонки: подходит и поле формы, и колонка списка. */
export interface CellField {
    readonly kind: FieldKind;
    readonly choices?: ReadonlyArray<string> | null | undefined;
    readonly suggestions?: unknown;
}

/** Тип ячейки поля. */
export function fieldCellType(field: CellField): CellType {
    return primitiveKinds[field.kind];
}

/**
 * Размер колонки поля вместо размера типа либо `undefined`, если подходит размер типа. Строка
 * с выбором из списка получает ширину самого длинного варианта, но не меньше ширины колонки
 * со списком, и не растёт.
 */
export function fieldColumnSize(field: CellField): ColumnSize | undefined {
    if (field.kind === 'string' && field.choices != null && field.choices.length > 0) {
        return { minimum: Math.max(listCellMinimum, ...field.choices.map((choice) => choice.length + 3)) };
    }
    return freeSizes[field.kind];
}

/**
 * Тип и размер колонки поля: их передают в колонку `DataTable` вместе. Поле с подсказками
 * или выбором из вариантов отмечается `list`: такая колонка шире, чтобы читались значение и список.
 */
export function fieldColumn(field: CellField): { readonly type: CellType; readonly size?: ColumnSize; readonly list?: boolean } {
    const size = fieldColumnSize(field);
    const list = field.suggestions != null || (field.choices != null && field.choices.length > 0);
    return { type: fieldCellType(field), ...(size === undefined ? {} : { size }), ...(list ? { list } : {}) };
}
