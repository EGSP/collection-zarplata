/** Прикладное правило закрытия: границу задают проведённые документы конфигурации. */
import { Effect } from 'effect';
import { Database } from '../../server/database/database.effect.js';
import { select } from '../../server/database/sql.builder.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import type { WritePolicy } from '../../server/metadata/index.js';
import { PeriodClosing } from '../documents/period-closing.document.js';

/**
 * Создаёт переиспользуемую политику для объекта, чьи записи могут затрагивать даты учёта.
 * Извлекатель дат задаёт конфигурация объекта; проверяются прежнее и предлагаемое состояния.
 */
export function closedPeriodPolicy<Record>(affectedDates: (record: Record) => readonly string[]): WritePolicy<Record> {
    return {
        name: 'closed-period',
        check: ({ before, after }) => Effect.gen(function* () {
            const dates = [...(before === null ? [] : affectedDates(before)), ...affectedDates(after)];
            if (dates.length === 0) return;
            const database = yield* Database;
            const closing = yield* database.get<{ closedThrough: string }>(select(`document_${PeriodClosing.name}`, {
                columns: ['closedThrough'],
                where: [
                    { column: 'posted', operator: '=', value: true },
                    { column: 'deletedAt', operator: '=', value: null },
                ],
                orderBy: [{ column: 'closedThrough', direction: 'DESC' }],
                limit: 1,
            }));
            if (closing === undefined) return;
            if (dates.some((date) => date <= closing.closedThrough)) {
                return yield* new DataPolicyError({ message: `Период закрыт по ${closing.closedThrough} включительно` });
            }
        }),
    };
}

/** Подключает правило к стандартной дате документа, сохраняя возможность другого извлекателя. */
export function closedPeriodByDocumentDate<Record extends { readonly date: string }>(): WritePolicy<Record> {
    return closedPeriodPolicy((record: Record) => [record.date.slice(0, 10)]);
}
