/** Общий текст ссылок для серверного поиска и всех мест отображения на клиенте. */
import type { ObjectReferenceValue, ObjectTarget, RecorderValue } from '../metadata/descriptions.js';
import type { ListColumn } from './descriptions.js';
import { formatDate } from './value-format.js';

/** Представления страницы по полному адресу записи; null означает отсутствие доступного текста. */
export type ReferencePresentations = Readonly<Record<string, string | null>>;

/** Однозначный ключ ссылки, включая вид и имя объекта, поскольку GUID сам по себе не задаёт адрес. */
export function referenceKey(reference: ObjectReferenceValue): string {
    return JSON.stringify([reference.kind, reference.name, reference.guid]);
}

/**
 * Извлекает полную ссылку из значения колонки; нессылочные и пустые значения возвращают null.
 * Вызывающий код передаёт значение с восстановленным типом по метаданным колонки.
 */
export function columnReference(column: ListColumn, value: unknown): ObjectReferenceValue | null {
    if (value === null || value === undefined) return null;
    if (column.kind === 'reference' && column.target !== null) return { ...column.target, guid: value as string };
    if (column.kind === 'objectReference') return value as ObjectReferenceValue;
    if (column.kind === 'recorder') {
        const recorder = value as RecorderValue;
        return { kind: 'document', name: recorder.document, guid: recorder.guid };
    }
    return null;
}

/** Название справочника либо заголовок, номер и дата документа; скрытые идентификаторы в текст не входят. */
export function recordPresentation(object: ObjectTarget & { readonly title: string }, record: Readonly<Record<string, unknown>>): string {
    if (object.kind === 'document') {
        const date = record['date'];
        return `${object.title} № ${String(record['number'] ?? '')} от ${typeof date === 'string' ? formatDate(date) : ''}`;
    }
    return String(record['name'] ?? '');
}
