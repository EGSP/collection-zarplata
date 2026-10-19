import { Cron, Effect, Result } from 'effect';
import { DataValidationError } from '../data/data.errors.js';
import { objectValue } from '../data/records.js';
import { Database } from '../database/database.effect.js';
import { insert, select, update } from '../database/sql.builder.js';
import { writeJournal } from '../journal/journal.js';
import type { BackupSettings } from '../settings/settings.service.js';

/** Единая настройка процесса; отсутствие строки сохраняет начальные значения файла настроек. */
const table = 'platform_backup_settings';
const key = [{ column: 'id', operator: '=' as const, value: 1 }];

/** Время изменения ограничивает догоняющий запуск: новое расписание действует только вперёд. */
export interface BackupSchedule {
    readonly schedule: ReadonlyArray<string>;
    readonly keep: number;
    readonly updatedAt: string | null;
}

/** Читает настройку через текущую транзакцию, чтобы пакет действий видел собственную запись. */
export const readBackupSettings = Effect.fn('backups.readSettings')(function* (initial: BackupSettings) {
    const database = yield* Database;
    const row = yield* database.get<{ schedule: string; keep: number; updatedAt: string }>(select(table, { where: key }));
    return row === undefined
        ? { schedule: initial.schedule, keep: initial.keep, updatedAt: null } satisfies BackupSchedule
        : { ...row, schedule: JSON.parse(row.schedule) as string[] } satisfies BackupSchedule;
});

/** Проверяет весь список до записи; ошибка называет строку и не меняет действующее расписание. */
export const saveBackupSettings = Effect.fn('backups.saveSettings')(function* (payload: unknown, initial: BackupSettings) {
    const value = objectValue(payload, 'payload');
    const schedule = value['schedule'];
    const keep = value['keep'];
    if (!Array.isArray(schedule) || schedule.some((line) => typeof line !== 'string')) {
        return yield* new DataValidationError({ message: 'Расписание должно быть списком строк cron', fields: ['schedule'] });
    }
    for (const [index, line] of (schedule as string[]).entries()) {
        const parsed = Cron.parse(line);
        if (Result.isFailure(parsed)) {
            return yield* new DataValidationError({ message: `Строка расписания «${line}» не разобрана: ${parsed.failure.message}`, fields: [`schedule.${index}`] });
        }
    }
    if (typeof keep !== 'number' || !Number.isSafeInteger(keep) || keep < 1) {
        return yield* new DataValidationError({ message: 'Число хранимых копий должно быть целым числом не меньше 1', fields: ['keep'] });
    }
    const before = yield* readBackupSettings(initial);
    const database = yield* Database;
    const occurredAt = new Date().toISOString();
    // Изменение только числа копий не отменяет срок, наступивший между проверками цикла.
    // У начального расписания нет границы активации, поэтому сохраняем начало эпохи.
    const updatedAt = JSON.stringify(before.schedule) === JSON.stringify(schedule)
        ? before.updatedAt ?? new Date(0).toISOString()
        : occurredAt;
    const values = { schedule: JSON.stringify(schedule), keep, updatedAt };
    yield* database.run(before.updatedAt === null ? insert(table, { id: 1, ...values }) : update(table, values, key));
    yield* writeJournal({
        occurredAt, target: { kind: 'platform', name: 'backups', guid: null }, action: 'saveSettings',
        changes: { schedule: { before: before.schedule, after: schedule }, keep: { before: before.keep, after: keep } },
    });
    return { schedule: schedule as string[], keep, updatedAt } satisfies BackupSchedule;
});
