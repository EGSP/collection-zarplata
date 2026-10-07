/**
 * Пробный справочник для проверки платформы, пока в конфигурации нет прикладных объектов.
 * Использует основные виды полей и табличную часть. Удаляется, когда появятся настоящие справочники.
 */
import { Effect } from 'effect';
import { ActionContext, ActionDispatcher } from '../../server/data/action-context.js';
import { catalog } from '../../server/metadata/index.js';
import { DataValidationError } from '../../server/data/data.errors.js';

/**
 * Пробный объект сохраняет действия для проверки вложенного вызова диспетчера: `inspect` читает
 * запись, `duplicate` создаёт копию, и журнал связывает её запись с вызвавшим действием.
 */
export const Sample = catalog('sample')
    .title('Пробный справочник')
    .field('comment', (field) => field.string().title('Комментарий').maximumLength(500))
    .field('quantity', (field) => field.number().title('Количество').integer().minimum(0))
    .field('amount', (field) => field.money().title('Сумма').minimum(0))
    .field('validFrom', (field) => field.date().title('Действует с'))
    .field('active', (field) => field.boolean().title('Активен').required())
    .tablePart('lines', (part) => part
        .title('Строки')
        .field('text', (field) => field.string().title('Текст').required()))
    .action('inspect', (action) => action
        .title('Прочитать через вложенное действие')
        .input((input) => input.field('guid', (field) => field.string().title('Идентификатор').required()))
        .handle((input) => Effect.gen(function* () {
            const context = yield* ActionContext;
            const dispatcher = yield* ActionDispatcher;
            const record = yield* dispatcher.execute({ target: { kind: 'catalog', name: 'sample' }, action: 'get', payload: { guid: input.guid } });
            return { record, userGuid: context.userGuid, traceGuid: context.traceGuid, actionGuid: context.actionGuid };
        })))
    .action('duplicate', (action) => action
        .title('Создать копию через вложенное действие')
        .input((input) => input.field('guid', (field) => field.string().title('Идентификатор').required()))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const target = { kind: 'catalog', name: 'sample' };
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.guid } })) as Record<string, unknown>;
            // guid и пометку удаления назначает платформа, во входных данных записи их нет.
            const { guid: _guid, deletedAt: _deletedAt, ...fields } = record;
            return yield* dispatcher.execute({ target, action: 'save', payload: { fields: { ...fields, name: `${String(record['name'])} (копия)` } } });
        })))
    .action('checkInformationRollback', (action) => action
        .title('Проверить откат объекта и сведений')
        .input((input) => input.field('externalObject', (field) => field.string().title('Внешний объект').required()))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({
                target: { kind: 'catalog', name: 'sample' }, action: 'save',
                payload: { fields: { name: input.externalObject, active: true, lines: [] } },
            })) as Record<string, unknown>;
            yield* dispatcher.execute({
                target: { kind: 'informationRegister', name: 'sample' }, action: 'save',
                payload: { fields: { source: 'rollback', externalObject: input.externalObject, description: 'Проверка отката', item: record['guid'] } },
            });
            // Ошибка после обеих записей проверяет общую транзакцию, а не откат отдельного save.
            return yield* new DataValidationError({ message: 'Пробная ошибка после записи объекта и сведений', fields: [] });
        })));
