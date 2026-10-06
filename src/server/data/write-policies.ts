/** Выполняет политики объекта перед стандартным изменяющим действием. */
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

/** Ошибка любой политики прерывает действие и откатывает всю транзакцию запроса. */
export function checkWritePolicies(
    description: ObjectDescription,
    change: { readonly action: string; readonly before: RecordValue | null; readonly after: RecordValue },
): Effect.Effect<void, unknown, PolicyRequirements> {
    return Effect.gen(function* () {
        const database = yield* DatabaseService;
        for (const policy of description.policies) {
            // После сборки описания тип конкретной записи стёрт; его проверил билдер объекта.
            const result = policy.check(change as never);
            if (!Effect.isEffect(result)) return yield* Effect.die(new Error(`Политика «${policy.name}» должна вернуть Effect`));
            yield* Effect.provideService(result as Effect.Effect<void, unknown, PolicyRequirements>, DatabaseService, readOnlyDatabase(database));
        }
    });
}
