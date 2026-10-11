/**
 * Действия независимых сведений используют общую транзакцию диспетчера, политики и журнал.
 * Составной первичный ключ не допускает дубликатов; save заменяет ресурсы целиком.
 */
import { Effect } from 'effect';
import { Database } from '../database/database.effect.js';
import { query, type QueryCondition } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { fieldsSchema } from '../metadata/schema.js';
import { recordChanges, writeJournal } from '../journal/journal.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { enforcePolicies } from './policies.js';
import { objectValue, validated, type RecordValue } from './records.js';
import { informationKey } from './information-key.js';

/** Отсекает технические идентификаторы и опечатки, чтобы неверная адресация не создала другую запись. */
function informationPayload(payload: unknown, property: 'fields' | 'dimensions'): RecordValue {
    const request = objectValue(payload, 'payload');
    for (const name of Object.keys(request)) {
        if (name !== property) throw new DataValidationError({ message: `Неизвестное свойство «${name}»`, fields: [`payload.${name}`] });
    }
    return request;
}

/** Строит отбор по полному проверенному ключу; значения остаются параметрами SQL. */
function keyConditions(key: RecordValue): QueryCondition<RecordValue>[] {
    return Object.entries(key).map(([column, value]) => ({ column, operator: '=', value }));
}

/** Читает сведения по полному ключу. Отсутствие строки возвращает 404. */
export const getInformation = Effect.fnUntraced(function* (description: ObjectDescription, payload: unknown) {
    const key = yield* informationKey(description, informationPayload(payload, 'dimensions')['dimensions']);
    const database = yield* Database;
    const row = yield* database.get<RecordValue>(query(description).select({ where: keyConditions(key) }));
    if (row === undefined) return yield* new DataNotFoundError({ message: `Запись регистра сведений «${description.name}» по указанным измерениям не найдена` });
    return row;
});

/**
 * Заменяет все ресурсы либо физически удаляет запись после прикладных проверок.
 * Диспетчер обязан вызвать функцию в транзакции с контекстом текущего действия.
 * При удалении отсутствующего ключа возвращает 404; пропущенный ресурс save очищает.
 */
export const mutateInformation = Effect.fnUntraced(function* (description: ObjectDescription, action: 'save' | 'delete', payload: unknown) {
    const occurredAt = new Date().toISOString();
    const request = informationPayload(payload, action === 'save' ? 'fields' : 'dimensions');
    const fields = action === 'save' ? objectValue(request['fields'], 'payload.fields') : undefined;
    if (fields !== undefined) {
        for (const name of Object.keys(fields)) {
            if (!description.fields.some((field) => field.name === name)) {
                return yield* new DataValidationError({ message: `Неизвестное поле «${name}»`, fields: [`payload.fields.${name}`] });
            }
        }
    }
    const rawKey = fields === undefined ? request['dimensions'] : Object.fromEntries(
        description.fields.filter((field) => field.role === 'dimension').map((field) => [field.name, fields[field.name]]),
    );
    const key = yield* informationKey(description, rawKey, action === 'save' ? 'payload.fields' : 'payload.dimensions');
    const database = yield* Database;
    const where = keyConditions(key);
    const builder = query(description);
    const row = yield* database.get<RecordValue>(builder.select({ where }));
    const before = row;
    let after: RecordValue;
    if (action === 'delete') {
        if (before === undefined) return yield* new DataNotFoundError({ message: `Запись регистра сведений «${description.name}» по указанным измерениям не найдена` });
        yield* enforcePolicies(description, { action: 'delete', input: { record: before } });
        yield* database.run(builder.remove(where));
        after = {};
    } else {
        const checked = yield* validated(fieldsSchema(description.fields), fields, 'payload.fields');
        after = Object.fromEntries(description.fields.map((field) => [field.name, checked[field.name] ?? null]));
        yield* enforcePolicies(description, { action: 'save', input: { existingRecord: before ?? null, proposedRecord: after } });
        // Диспетчер уже держит транзакцию: прочитанная строка не изменится между чтением и записью.
        yield* database.run(before === undefined ? builder.insert(after) : builder.update(after, where));
    }
    yield* writeJournal({
        occurredAt,
        target: { kind: description.kind, name: description.name, guid: null, key },
        action,
        changes: recordChanges(description, before, after),
    });
    return action === 'delete' ? { dimensions: key, deleted: true } : after;
});
