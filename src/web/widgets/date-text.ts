/** Единые строгие правила ручного ввода даты для шапки и табличной части. */
import dayjs from 'dayjs';
import type { DateLimits } from './widget';

export type DateKind = 'date' | 'dateTime';

/** Неполную и несуществующую дату не дополняем и не переносим на следующий месяц. */
export function parseDateText(text: string, kind: DateKind): string | null | undefined {
    if (text === '') return null;
    const match = (kind === 'date' ? /^(\d{2})\.(\d{2})\.(\d{4})$/u : /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2})$/u).exec(text);
    if (match === null) return undefined;
    const [, day, month, year, hour, minute] = match;
    const date = dayjs(`${year}-${month}-${day}${kind === 'date' ? '' : `T${hour}:${minute}`}`);
    if (!date.isValid() || date.format(kind === 'date' ? 'DD.MM.YYYY' : 'DD.MM.YYYY HH:mm') !== text) return undefined;
    return kind === 'date' ? date.format('YYYY-MM-DD') : date.toISOString();
}

/** Ошибка называет формат или включительную границу доступного периода. */
export function dateTextError(text: string, kind: DateKind, limits?: DateLimits): string | null {
    const value = parseDateText(text, kind);
    if (value === undefined) return kind === 'date' ? 'Неверная дата. Формат дд.мм.гггг' : 'Неверная дата. Формат дд.мм.гггг чч:мм';
    if (value === null) return null;
    const date = dayjs(value).format('YYYY-MM-DD');
    if (limits?.minimum !== undefined && date < limits.minimum) return `Дата не раньше ${dayjs(limits.minimum).format('DD.MM.YYYY')}`;
    if (limits?.maximum !== undefined && date > limits.maximum) return `Дата не позже ${dayjs(limits.maximum).format('DD.MM.YYYY')}`;
    return null;
}
