/**
 * Сценарий рабочего потока снимка базы. Поток получает пути через `workerData`, пишет снимок
 * и отправляет результат основному потоку. Верхнеуровневый `await` не используется: в исполняемом
 * файле сценарий собирается в формат CommonJS, где он недопустим.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { writeSnapshot, type SnapshotRequest } from './database.snapshot.js';

void writeSnapshot(workerData as SnapshotRequest).then((result) => parentPort?.postMessage(result));
