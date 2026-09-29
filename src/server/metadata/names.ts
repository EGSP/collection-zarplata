/**
 * Проверка имён объектов, полей, табличных частей и действий.
 * Из этих имён строятся имена таблиц и колонок, поэтому они должны быть допустимы в SQL.
 */

/** lowerCamelCase латиницей: буква в начале, дальше буквы и цифры, без `_`. */
const namePattern = /^[a-z][A-Za-z0-9]*$/;

const maximumNameLength = 60;

/** Ключевые слова SQLite: https://www.sqlite.org/lang_keywords.html */
const sqlKeywords: ReadonlySet<string> = new Set(
    `abort action add after all alter always analyze and as asc attach autoincrement before begin between by cascade
    case cast check collate column commit conflict constraint create cross current current_date current_time
    current_timestamp database default deferrable deferred delete desc detach distinct do drop each else end escape
    except exclude exclusive exists explain fail filter first following for foreign from full generated glob group
    groups having if ignore immediate in index indexed initially inner insert instead intersect into is isnull join key
    last left like limit match materialized natural no not nothing notnull null nulls of offset on or order others
    outer over partition plan pragma preceding primary query raise range recursive references regexp reindex release
    rename replace restrict returning right rollback row rows savepoint select set table temp temporary then ties to
    transaction trigger unbounded union unique update using vacuum values view virtual when where window with without`
        .split(/\s+/)
        .filter((word) => word !== ''),
);

/** Возвращает описание проблемы с именем или `null`, если имя допустимо. */
export function checkName(name: string): string | null {
    if (!namePattern.test(name)) {
        return `имя «${name}» должно быть в lowerCamelCase латиницей: начинаться со строчной буквы и содержать только буквы и цифры`;
    }
    if (name.length > maximumNameLength) {
        return `имя «${name}» длиннее ${maximumNameLength} символов`;
    }
    if (sqlKeywords.has(name.toLowerCase())) {
        return `имя «${name}» совпадает с ключевым словом SQL`;
    }
    return null;
}
