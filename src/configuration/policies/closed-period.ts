/** Прикладное правило закрытия: границу задают проведённые документы конфигурации. */
import { Effect } from 'effect';
import { Database } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import type { Policy } from '../../server/metadata/index.js';
import { periodClosingHead } from '../period-closing.js';

/**
 * Граница последнего проведённого закрытия, включительно, датой `ГГГГ-ММ-ДД`; без закрытий `null`.
 * Её читают и политика, и расчёт зарплаты: период расчёта начинается со следующего дня.
 */
export const lastClosedThrough = Effect.gen(function* () {
    const database = yield* Database;
    const closing = yield* database.get(query(periodClosingHead).select({
        columns: ['closedThrough'],
        where: [
            { column: 'posted', operator: '=', value: true },
            { column: 'deletedAt', operator: '=', value: null },
        ],
        orderBy: [{ column: 'closedThrough', direction: 'DESC' }],
        limit: 1,
    }));
    return closing?.closedThrough ?? null;
});

/**
 * День значения даты или даты со временем: первые десять знаков ISO 8601. Граница закрытия
 * сравнивается с днём документа, а не с моментом: период закрывается целыми днями.
 */
export const dayOf = (value: string): string => value.slice(0, 10);

/**
 * Создаёт переиспользуемую политику для объекта, чьи записи могут затрагивать даты учёта.
 * Извлекатель дат задаёт конфигурация объекта. Сохранение по умолчанию проверяет даты обеих
 * записей, остальные изменяющие действия — существующую запись до начала выполнения.
 *
 * `changedDates` заменяет проверку сохранения, если запись в закрытом периоде можно дополнять.
 * Например, рассрочка из закрытого периода принимает новые взносы: проверяются только даты
 * изменённых частей, а не все даты записи.
 */
export function closedPeriodPolicy<Record>(
    affectedDates: (record: Record) => readonly string[],
    changedDates: (existingRecord: Record | null, proposedRecord: Record) => readonly string[] =
    (existingRecord, proposedRecord) => [...(existingRecord === null ? [] : affectedDates(existingRecord)), ...affectedDates(proposedRecord)],
): Policy<Record> {
    const checkDates = (dates: readonly string[]) => Effect.gen(function* () {
        if (dates.length === 0) return;
        const closedThrough = yield* lastClosedThrough;
        if (closedThrough === null) return;
        if (dates.some((date) => dayOf(date) <= closedThrough)) {
            return yield* new DataPolicyError({ message: `Период закрыт по ${closedThrough} включительно` });
        }
    });
    const checkRecord = (record: Record) => checkDates(affectedDates(record));
    return {
        name: 'closed-period',
        save: ({ existingRecord, proposedRecord }) => checkDates(changedDates(existingRecord, proposedRecord)),
        post: ({ document }) => checkRecord(document),
        unpost: ({ document }) => checkRecord(document),
        markDeleted: ({ record }) => checkRecord(record),
        unmarkDeleted: ({ record }) => checkRecord(record),
    };
}

/** Подключает правило к стандартной дате документа, сохраняя возможность другого извлекателя. */
export function closedPeriodByDocumentDate<Record extends { readonly date: string }>(): Policy<Record> {
    return closedPeriodPolicy((record: Record) => [record.date]);
}
