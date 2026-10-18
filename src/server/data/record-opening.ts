/** Общий серверный выбор формы: клиент передаёт исходную ссылку, конфигурация выбирает цель. */
import { Effect } from 'effect';
import { CurrentUserRights } from '../authorization/current-user-rights.js';
import { readRight } from '../authorization/rights.js';
import type { ObjectReferenceValue } from '../metadata/descriptions.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { guidValue, loadRecord, objectValue, stringValue } from './records.js';

/** Проверяет и клиентскую ссылку, и результат правила до поиска объекта и обращения к базе. */
function referenceValue(value: unknown): ObjectReferenceValue {
    const reference = objectValue(value, 'payload.reference');
    const kind = reference['kind'];
    if (kind !== 'catalog' && kind !== 'document') {
        throw new DataValidationError({ message: 'Открыть можно запись справочника или документа', fields: ['payload.reference.kind'] });
    }
    return { kind, name: stringValue(reference['name'], 'payload.reference.name'), guid: guidValue(reference['guid'], 'payload.reference.guid') };
}

/**
 * Выполняется в транзакции диспетчера. Сначала проверяет право чтения, затем существование каждой
 * записи, включая исходную. Отказ не подменяется исходной формой. original отключает только правило.
 * null и ссылка на себя завершают цепочку; повтор иной записи и цепочка длиннее 32 дают 400.
 */
export const resolveRecordOpening = Effect.fn('resolveRecordOpening')(function* (payload: unknown) {
    const input = objectValue(payload, 'payload');
    if (input['original'] !== undefined && typeof input['original'] !== 'boolean') {
        return yield* new DataValidationError({ message: 'original должен быть логическим значением', fields: ['payload.original'] });
    }
    let reference = referenceValue(input['reference']);
    const metadata = yield* Metadata;
    const rights = yield* CurrentUserRights;
    const visited = new Set<string>();
    for (let depth = 0; depth < 32; depth++) {
        const key = `${reference.kind}.${reference.name}.${reference.guid}`;
        if (visited.has(key)) break;
        visited.add(key);
        const description = metadata.find(reference.kind, reference.name);
        if (description === undefined) return yield* new DataNotFoundError({ message: `Объект ${reference.kind}.${reference.name} не найден` });
        yield* rights.require(readRight(description));
        const record = yield* loadRecord(description, reference.guid);
        if (input['original'] === true || description.opening === null) return reference;
        // Тип аргумента соответствует описанию, по которому только что прочитана запись.
        const result = description.opening(record as never);
        if (result === null) return reference;
        const next = referenceValue(result);
        if (next.kind === reference.kind && next.name === reference.name && next.guid === reference.guid) return reference;
        reference = next;
    }
    return yield* new DataValidationError({ message: 'Правила открытия образуют цикл или слишком длинную цепочку', fields: ['payload.reference'] });
});
