/**
 * Ставка собственной рассрочки: запись «Собственная» с 0 % в справочнике «Ставки по рассрочке».
 * Собственной рассрочке проставляется именно она, поэтому запись должна быть в любой базе.
 */
import { Effect } from 'effect';
import { InstallmentRates, ownInstallmentRateName } from '../../configuration/catalogs/installment-rates.catalog.js';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { query } from '../database/sql.builder.js';

/** Операция записи ставки в формате единого эндпоинта `POST /api/perform`. */
export interface InstallmentRateSaveOperation {
    readonly target: { readonly kind: 'catalog'; readonly name: 'installmentRates' };
    readonly action: 'save';
    readonly payload: { readonly fields: { readonly name: string; readonly percentage: number } };
}

/**
 * Готовит запись ставки «Собственная», если её нет. Запись с пометкой удаления тоже считается:
 * иначе каждый запуск создавал бы новую, пока старая помечена. Запись выполняет диспетчер
 * действий, а не прямой SQL: так проверяются политики справочника и пишется журнал.
 */
export const ownInstallmentRateOperations: Effect.Effect<ReadonlyArray<InstallmentRateSaveOperation>, DatabaseError, Database> = Effect.gen(function* () {
    const database = yield* Database;
    const existing = yield* database.get(query(InstallmentRates).select({
        columns: ['guid'],
        where: [{ column: 'name', operator: '=', value: ownInstallmentRateName }],
        limit: 1,
    }));
    if (existing !== undefined) return [];
    return [{ target: { kind: 'catalog', name: 'installmentRates' }, action: 'save', payload: { fields: { name: ownInstallmentRateName, percentage: 0 } } } as const];
});
