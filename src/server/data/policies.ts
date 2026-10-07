/** Вызывает соответствующие обработчики политик перед стандартным изменяющим действием. */
import { Effect } from 'effect';
import type { Database } from '../database/database.effect.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import type { Metadata } from '../metadata/metadata.effect.js';
import type { ActionContext, ActionDispatcher } from './action-context.js';
import type { RecordValue } from './records.js';
import { readOnlyDatabase } from './read-only-database.js';
import { Database as DatabaseService } from '../database/database.effect.js';

/** Сервисы, доступные прикладной проверке в той же транзакции, что и действие. */
type PolicyRequirements = Database | Metadata | ActionContext | ActionDispatcher;

/** Действие выбирает собственный контракт входных данных политики. */
export type PolicyInvocation =
    | { readonly action: 'save'; readonly input: { readonly existingRecord: RecordValue | null; readonly proposedRecord: RecordValue } }
    | { readonly action: 'post' | 'unpost'; readonly input: { readonly document: RecordValue } }
    | { readonly action: 'markDeleted' | 'unmarkDeleted' | 'delete'; readonly input: { readonly record: RecordValue } };

/** Ошибка любой политики прерывает действие и откатывает всю транзакцию запроса. */
export function enforcePolicies(
    description: ObjectDescription,
    invocation: PolicyInvocation,
): Effect.Effect<void, unknown, PolicyRequirements> {
    return Effect.gen(function* () {
        const database = yield* DatabaseService;
        for (const policy of description.policies) {
            const handler = policy[invocation.action];
            if (handler === null) continue;
            // После сборки описания тип конкретной записи стёрт; его проверил билдер объекта.
            const result = handler(invocation.input as never);
            if (!Effect.isEffect(result)) return yield* Effect.die(new Error(`Политика «${policy.name}» должна вернуть Effect`));
            yield* Effect.provideService(result as Effect.Effect<void, unknown, PolicyRequirements>, DatabaseService, readOnlyDatabase(database));
        }
    });
}
