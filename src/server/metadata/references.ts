/** Общая адресация записей, независимая от места показа ссылки и вида поля. */
import type { ObjectReferenceValue, ObjectTarget } from './descriptions.js';

/** Строит полную ссылку из известного целевого объекта и проверенного guid записи. */
export function objectReference(target: ObjectTarget, guid: string): ObjectReferenceValue {
    return { kind: target.kind, name: target.name, guid };
}
