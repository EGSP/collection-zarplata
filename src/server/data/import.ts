/** Импорт связывает внешние адреса с записями через вложенные действия общей транзакции. */
import { Effect } from 'effect';
import { ActionDispatcher } from './action-context.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { objectValue, stringValue, type RecordValue } from './records.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { writeJournal } from '../journal/journal.js';

/**
 * Создаёт либо заменяет записи по внешним связям в исходном порядке.
 * Вызывается диспетчером в транзакции. Права, политики и журнал каждой записи
 * проверяются вложенным save; ошибка любого элемента отменяет всю порцию.
 */
export const importCatalog = Effect.fnUntraced(function* (description: ObjectDescription, payload: unknown) {
    const occurredAt = new Date().toISOString();
    const request = objectValue(payload, 'payload');
    const externalSystem = stringValue(request['externalSystem'], 'payload.externalSystem');
    const items = request['items'];
    if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
        return yield* new DataValidationError({ message: 'Порция должна содержать от 1 до 500 элементов', fields: ['payload.items'] });
    }
    const dispatcher = yield* ActionDispatcher;
    const results: RecordValue[] = [];
    for (const [index, raw] of items.entries()) {
        const location = `payload.items.${index}`;
        const item = objectValue(raw, location);
        const sourceObject = stringValue(item['sourceObject'], `${location}.sourceObject`);
        const externalIdentifier = stringValue(item['externalIdentifier'], `${location}.externalIdentifier`);
        const work = Effect.gen(function* () {
            const fields = objectValue(item['fields'], `${location}.fields`);
            for (const name of Object.keys(fields)) {
                if (!description.fields.some((field) => field.name === name && !field.managed) && !description.tableParts.some((part) => part.name === name)) {
                    return yield* new DataValidationError({ message: `Неизвестное или служебное поле «${name}»`, fields: [`payload.fields.${name}`] });
                }
            }
            const dimensions = { externalSystem, sourceObject, externalIdentifier };
            const target = { kind: 'informationRegister', name: 'externalLinks' };
            const link = yield* dispatcher.execute({ target, action: 'get', payload: { dimensions } }).pipe(
                Effect.catchIf((error): error is DataNotFoundError => error instanceof DataNotFoundError, () => Effect.succeed(null)),
            ) as Effect.Effect<RecordValue | null, unknown>;
            if (link !== null && link['targetObject'] !== description.name) {
                return yield* new DataValidationError({ message: 'Внешний объект уже связан с другим справочником', fields: [`${location}.externalIdentifier`] });
            }
            const record = (yield* dispatcher.execute({
                target: { kind: 'catalog', name: description.name }, action: 'save',
                payload: { ...(link === null ? {} : { guid: link['recordGuid'] }), fields },
            })) as RecordValue;
            if (link === null) yield* dispatcher.execute({
                target, action: 'save', payload: { fields: { ...dimensions, targetObject: description.name, recordGuid: record['guid'] } },
            });
            return { externalIdentifier, guid: record['guid'], status: link === null ? 'created' : 'updated' };
        });
        results.push(yield* work.pipe(Effect.catchIf((error): error is DataValidationError => error instanceof DataValidationError, (error) => Effect.fail(new DataValidationError({
            message: `Элемент ${index + 1} (${externalIdentifier}): ${error.message}`,
            fields: error.fields.map((field) => field.replace(/^payload\.fields/, `${location}.fields`)),
        })))));
    }
    yield* writeJournal({ occurredAt, target: { kind: description.kind, name: description.name, guid: null }, action: 'import', changes: null });
    return results;
});
