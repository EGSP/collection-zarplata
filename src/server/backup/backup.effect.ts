/**
 * Бизнес-логика резервного копирования: имена файлов копий, их перечень и чистка, запись одной
 * копии и сроки расписания. Состояние идущих копий и запуск по расписанию держит `BackupService`.
 */
import { Cron, Data, Effect, Exit } from 'effect';
import { mkdir, readdir, rename, rm, stat, statfs } from 'node:fs/promises';
import path from 'node:path';
import { removeSnapshot, startSnapshotWorker, type SnapshotResult } from '../database/database.snapshot.js';
import type { BackupFile, BackupSource, DiskUsage } from './descriptions.js';

/** Ошибка файловой системы или снимка базы. Текст показывается администратору на странице копий. */
export class BackupError extends Data.TaggedError('BackupError')<{
    readonly message: string;
}> {}

/** Выполняет файловую операцию и превращает её отказ в `BackupError` с понятным началом текста. */
function fileOperation<Value>(description: string, operation: () => Promise<Value>): Effect.Effect<Value, BackupError> {
    return Effect.tryPromise({
        try: operation,
        catch: (cause) => new BackupError({ message: `${description}: ${cause instanceof Error ? cause.message : String(cause)}` }),
    });
}

/**
 * Имя копии: `backup-2026-10-18_08-00-12-345-schedule.db`. Время местное, как в строках cron,
 * и с миллисекундами, чтобы две ручные копии подряд не получили одно имя. По имени восстанавливаются
 * время и источник копии: отдельного хранилища сведений о копиях нет.
 */
const fileNamePattern = /^backup-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})-(schedule|manual)\.db$/;

/** Суффикс файла, который пишется сейчас. Только после проверки файл переименовывается в копию. */
const partialSuffix = '.partial';

function twoDigits(value: number, width = 2): string {
    return String(value).padStart(width, '0');
}

/** Имя файла копии по времени её начала и источнику. */
export function backupFileName(startedAt: Date, source: BackupSource): string {
    const date = `${startedAt.getFullYear()}-${twoDigits(startedAt.getMonth() + 1)}-${twoDigits(startedAt.getDate())}`;
    const time = `${twoDigits(startedAt.getHours())}-${twoDigits(startedAt.getMinutes())}-${twoDigits(startedAt.getSeconds())}-${twoDigits(startedAt.getMilliseconds(), 3)}`;
    return `backup-${date}_${time}-${source}.db`;
}

/** Время и источник из имени копии; посторонний файл в каталоге даёт `undefined`. */
function parseBackupFileName(name: string): { readonly createdAt: Date; readonly source: BackupSource } | undefined {
    const match = fileNamePattern.exec(name);
    if (match === null) return undefined;
    const [, year, month, day, hours, minutes, seconds, milliseconds, source] = match;
    return {
        createdAt: new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds), Number(milliseconds)),
        source: source as BackupSource,
    };
}

/** Создаёт каталог копий, если его нет. */
export const ensureBackupDirectory = (directory: string) =>
    fileOperation(`Не удалось создать каталог копий ${directory}`, () => mkdir(directory, { recursive: true })).pipe(Effect.asVoid);

/**
 * Готовые копии в каталоге, новые первыми. Учитываются только файлы с именем копии: другие файлы
 * администратора здесь не показываются и не удаляются.
 */
export const listBackups = Effect.fn('backup.list')(function* (directory: string) {
    const names = yield* fileOperation(`Не удалось прочитать каталог копий ${directory}`, () => readdir(directory));
    const files: Array<BackupFile> = [];
    for (const name of names) {
        const parsed = parseBackupFileName(name);
        if (parsed === undefined) continue;
        const information = yield* fileOperation(`Не удалось прочитать файл копии ${name}`, () => stat(path.join(directory, name)));
        files.push({ name, size: information.size, createdAt: parsed.createdAt.toISOString(), source: parsed.source });
    }
    return files.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
});

/** Место на диске с каталогом копий. `bavail` учитывает квоты: столько может записать процесс. */
export const diskUsage = (directory: string): Effect.Effect<DiskUsage, BackupError> =>
    fileOperation(`Не удалось прочитать место на диске ${directory}`, () => statfs(directory)).pipe(Effect.map((information) => ({
        total: information.blocks * information.bsize,
        used: (information.blocks - information.bfree) * information.bsize,
        free: information.bavail * information.bsize,
    })));

/**
 * Удаляет недописанные файлы, оставшиеся после аварийной остановки процесса. Вызывается при запуске,
 * когда ни одна копия ещё не идёт.
 */
export const removePartialBackups = Effect.fn('backup.removePartial')(function* (directory: string) {
    const names = yield* fileOperation(`Не удалось прочитать каталог копий ${directory}`, () => readdir(directory));
    for (const name of names.filter((value) => value.endsWith(partialSuffix))) {
        yield* fileOperation(`Не удалось удалить недописанную копию ${name}`, () => removeSnapshot(path.join(directory, name)));
    }
});

/** Оставляет `keep` новых копий, остальные удаляет. Вызывается только после успешной копии. */
export const pruneBackups = Effect.fn('backup.prune')(function* (directory: string, keep: number) {
    const files = yield* listBackups(directory);
    for (const file of files.slice(keep)) {
        yield* fileOperation(`Не удалось удалить старую копию ${file.name}`, () => rm(path.join(directory, file.name), { force: true }));
    }
});

/**
 * Пишет снимок в рабочем потоке. Прерывание файбера завершает поток: так отменяется копия и
 * останавливается сервер. `terminate` дожидается остановки потока, а она наступает только после
 * текущего нативного шага драйвера.
 */
function snapshot(source: string, target: string): Effect.Effect<void, BackupError> {
    return Effect.callback<void, BackupError>((resume) => {
        const worker = startSnapshotWorker({ source, target });
        worker.once('message', (result: SnapshotResult) => resume(result.ok ? Effect.void : Effect.fail(new BackupError({ message: result.message }))));
        worker.once('error', (cause: Error) => resume(Effect.fail(new BackupError({ message: `Ошибка потока копирования: ${cause.message}` }))));
        worker.once('exit', (code) => resume(Effect.fail(new BackupError({ message: `Поток копирования завершился без результата, код ${code}` }))));
        return Effect.promise(() => worker.terminate()).pipe(Effect.asVoid);
    });
}

/**
 * Одна копия: снимок во временный файл, проверка внутри снимка, переименование в копию и чистка
 * старых копий. При ошибке или отмене временный файл удаляется, а прежние копии остаются.
 */
export const writeBackup = Effect.fn('backup.write')(function* (databasePath: string, directory: string, keep: number, source: BackupSource, startedAt: Date) {
    yield* ensureBackupDirectory(directory);
    const name = backupFileName(startedAt, source);
    const partial = path.join(directory, `${name}${partialSuffix}`);
    yield* snapshot(databasePath, partial).pipe(Effect.onExit((exit) => Exit.isSuccess(exit)
        ? Effect.void
        : Effect.promise(() => removeSnapshot(partial).catch(() => undefined))));
    yield* fileOperation(`Не удалось переименовать копию ${name}`, () => rename(partial, path.join(directory, name)));
    yield* pruneBackups(directory, keep);
    return name;
});

/** Разбирает строки расписания. Настройки уже проверили их при запуске, поэтому ошибка здесь невозможна. */
export function parseSchedule(lines: ReadonlyArray<string>): ReadonlyArray<Cron.Cron> {
    return lines.map((line) => Cron.parseUnsafe(line));
}

/**
 * Последний наступивший срок по всем строкам расписания. `Cron.prev` строгий: срок, совпадающий
 * с моментом поиска с точностью до секунды, он пропускает. Поэтому поиск начинается со следующей
 * секунды, и срок 08:00:00 находится уже в 08:00:00.
 */
export function latestDue(crons: ReadonlyArray<Cron.Cron>, now: Date): Date | undefined {
    if (crons.length === 0) return undefined;
    const from = new Date(Math.floor(now.getTime() / 1000) * 1000 + 1000);
    return new Date(Math.max(...crons.map((cron) => Cron.prev(cron, from).getTime())));
}

/** Ближайший будущий срок по всем строкам расписания. */
export function nextDue(crons: ReadonlyArray<Cron.Cron>, now: Date): Date | undefined {
    if (crons.length === 0) return undefined;
    return new Date(Math.min(...crons.map((cron) => Cron.next(cron, now).getTime())));
}
