/**
 * Размер колонки таблицы по виду поля. Таблицы строятся по описаниям с сервера, поэтому размер
 * по умолчанию выводится из вида: дате и сумме нужна своя ширина, а названию и ссылке — остаток.
 * Экран переопределяет размер только там, где знает больше вида поля, например что строка
 * «Код» короткая. Описание поля в конфигурации о размере колонки ничего не знает: это решение
 * интерфейса, а не данных.
 */
import type { FieldKind } from '../../../server/ui/descriptions';
import type { ColumnSize } from '../ds/table-layout';

/**
 * Размеры по видам. Минимум в знаках рассчитан на отображение и на поле ввода в режиме
 * редактирования: дате нужен ещё значок календаря, ссылке — кнопки подбора и перехода.
 */
const kindSizes: { readonly [Kind in FieldKind]: ColumnSize } = {
    string: { minimum: 12, weight: 1 },
    number: { minimum: 8 },
    // «1 234 567,89» — двенадцать знаков.
    money: { minimum: 12 },
    // «28.10.2026» и значок календаря.
    date: { minimum: 13 },
    dateTime: { minimum: 18 },
    boolean: { minimum: 4 },
    reference: { minimum: 18, weight: 2 },
    objectReference: { minimum: 18, weight: 2 },
    composite: { minimum: 18, weight: 2 },
    guid: { minimum: 36 },
    recorder: { minimum: 20, weight: 1 },
};

/** Что нужно знать о поле для размера колонки: подходит и поле формы, и колонка списка. */
export interface SizedField {
    readonly kind: FieldKind;
    readonly title: string;
    readonly choices?: ReadonlyArray<string> | null | undefined;
}

/**
 * Размер колонки поля. Колонка не уже самого длинного слова своего заголовка: заголовок
 * переносится по словам, но слово не разрывается. У строки с выбором из списка ширина
 * по самому длинному варианту и стрелке списка, и такая колонка не растёт.
 */
export function fieldColumnSize(field: SizedField): ColumnSize {
    const base = field.kind === 'string' && field.choices != null && field.choices.length > 0
        ? { minimum: Math.max(...field.choices.map((choice) => choice.length)) + 3 }
        : kindSizes[field.kind];
    // Знак `ch` — ширина цифры обычного начертания. Заголовок набран полужирным, а кириллические
    // буквы вроде «м» и «ш» шире цифры, поэтому длина слова берётся с запасом в пятую часть.
    const word = Math.ceil(Math.max(0, ...field.title.split(/\s+/u).map((part) => part.length)) * 1.2);
    return { ...base, minimum: Math.max(base.minimum, word) };
}
