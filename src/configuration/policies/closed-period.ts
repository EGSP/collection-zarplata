/** Прикладное правило закрытия: границу задают проведённые документы конфигурации. */
import { Effect } from 'effect';
import { Database } from '../../server/database/database.effect.js';
import { select } from '../../server/database/sql.builder.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import type { Policy } from '../../server/metadata/index.js';
import { PeriodClosing } from '../documents/period-closing.document.js';

/**
 * Создаёт переиспользуемую политику для объекта, чьи записи могут затрагивать даты учёта.
 * Извлекатель дат задаёт конфигурация объекта. Сохранение проверяет обе записи, остальные
 * изменяющие действия — существующую запись до начала выполнения.
 */
export function closedPeriodPolicy<Record>(affectedDates: (record: Record) => readonly string[]): Policy<Record> {
    const checkDates = (dates: readonly string[]) => Effect.gen(function* () {
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
    });
    const checkRecord = (record: Record) => checkDates(affectedDates(record));
    return {
        name: 'closed-period',
        save: ({ before, after }) => checkDates([...(before === null ? [] : affectedDates(before)), ...affectedDates(after)]),
        post: ({ document }) => checkRecord(document),
        unpost: ({ document }) => checkRecord(document),
        markDeleted: ({ record }) => checkRecord(record),
        unmarkDeleted: ({ record }) => checkRecord(record),
    };
}

/** Подключает правило к стандартной дате документа, сохраняя возможность другого извлекателя. */
export function closedPeriodByDocumentDate<Record extends { readonly date: string }>(): Policy<Record> {
    return closedPeriodPolicy((record: Record) => [record.date.slice(0, 10)]);
}
