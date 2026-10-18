/**
 * Согласованный снимок файла базы во время работы приложения.
 *
 * Метод `backup()` драйвера Turso не реализован, поэтому снимок пишет команда `VACUUM INTO`.
 * Она читает базу в одной транзакции чтения: запись основного соединения продолжается, а в копию
 * попадает состояние на начало команды. Блокировать базу не нужно.
 *
 * Драйвер выполняет `VACUUM INTO` одним синхронным шагом. В основном потоке это остановило бы
 * обработку запросов на всё время копирования, поэтому снимок пишет рабочий поток со своим
 * соединением только для чтения. Объект соединения между потоками не передаётся, и основное
 * соединение `DatabaseService` здесь не участвует.
 */
import { connect } from '@tursodatabase/database';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { Worker } from 'node:worker_threads';

/** Файл базы и новый файл снимка; файла снимка ещё не должно быть. */
export interface SnapshotRequest {
    readonly source: string;
    readonly target: string;
}

/** Ответ рабочего потока: снимок записан и проверен либо текст ошибки. */
export type SnapshotResult = { readonly ok: true } | { readonly ok: false; readonly message: string };

/** Имя ресурса SEA со сценарием рабочего потока; его собирает и встраивает скрипт упаковки. */
export const snapshotWorkerAsset = 'snapshot-worker.cjs';

/** `VACUUM INTO` принимает путь только строковым литералом, параметр запроса драйвер отклоняет. */
function sqlString(value: string): string {
    return `'${value.replaceAll("'", "''")}'`;
}

/** Служебные файлы WAL, которые драйвер оставляет рядом с файлом снимка. */
async function removeWalFiles(file: string): Promise<void> {
    await Promise.all(['-wal', '-shm'].map((suffix) => rm(`${file}${suffix}`, { force: true })));
}

/**
 * Пишет снимок и проверяет его `PRAGMA integrity_check`. Выполняется в рабочем потоке: функция
 * не зависит от Nest и Effect и получает только пути. Повреждённый снимок считается ошибкой,
 * чтобы непригодный файл не выглядел резервной копией.
 */
export async function writeSnapshot({ source, target }: SnapshotRequest): Promise<SnapshotResult> {
    try {
        const database = await connect(source, { readonly: true });
        try {
            await database.exec(`VACUUM INTO ${sqlString(target)}`);
        } finally {
            await database.close();
        }
        const copy = await connect(target, { readonly: true });
        let check: unknown;
        try {
            check = (await (await copy.prepare('PRAGMA integrity_check')).get() as { integrity_check?: unknown } | undefined)?.integrity_check;
        } finally {
            await copy.close();
        }
        // Снимок содержит все данные в основном файле; пустые файлы WAL рядом с ним не нужны.
        await removeWalFiles(target);
        return check === 'ok' ? { ok: true } : { ok: false, message: `Проверка копии не пройдена: ${String(check)}` };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/**
 * Запускает рабочий поток снимка. При запуске из исходников поток загружает соседний скомпилированный
 * файл. В исполняемом файле отдельных файлов нет: сценарий потока лежит в ресурсах SEA, а путь
 * к нативному модулю Turso поток получает из `process.env`, общего для потоков процесса.
 */
export function startSnapshotWorker(request: SnapshotRequest): Worker {
    if (isSea()) return new Worker(getAsset(snapshotWorkerAsset, 'utf8'), { eval: true, workerData: request });
    return new Worker(path.join(import.meta.dirname, 'snapshot.worker.js'), { workerData: request });
}

/** Удаляет файл снимка вместе со служебными файлами WAL, например после отмены или ошибки. */
export async function removeSnapshot(file: string): Promise<void> {
    await Promise.all([rm(file, { force: true }), removeWalFiles(file)]);
}
