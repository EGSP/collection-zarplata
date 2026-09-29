/**
 * Пробный справочник для проверки платформы, пока в конфигурации нет прикладных объектов.
 * Использует основные виды полей и табличную часть. Удаляется, когда появятся настоящие справочники.
 */
import { Effect } from 'effect';
import { ActionContext, ActionDispatcher } from '../../server/data/action-context.js';
import { catalog } from '../../server/metadata/index.js';

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
            return { record, traceGuid: context.traceGuid, actionGuid: context.actionGuid };
        })));
