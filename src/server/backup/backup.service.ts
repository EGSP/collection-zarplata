import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Duration, Effect, Fiber } from 'effect';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { DatabaseService } from '../database/database.service.js';
import { readBackupSettings } from './backup-settings.js';
import { newGuid } from '../common/guid.js';
import { DataNotFoundError, DataPolicyError } from '../data/data.errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { diskUsage, ensureBackupDirectory, latestDue, listBackups, nextDue, parseSchedule, removePartialBackups, writeBackup } from './backup.effect.js';
import type { BackupOutcome, BackupOverview, BackupSource, RunningBackup } from './descriptions.js';

/**
 * Сколько копий может идти одновременно. Каждая копия читает всю базу своим потоком, поэтому
 * больше двух только замедлили бы диск, не давая новых данных.
 */
const runningLimit = 2;

/**
 * Как часто плановый цикл сверяется с часами. Короткая проверка вместо одного длинного таймера
 * переживает сон компьютера, перевод часов и занятый процесс: опоздание срока не больше этого
 * интервала, а наступивший срок не теряется.
 */
const checkInterval = Duration.seconds(30);

/** Идущая копия и её файбер: через файбер копию прерывают. */
interface RunningEntry {
    information: RunningBackup;
    fiber: Fiber.Fiber<unknown, unknown> | undefined;
}

/**
 * Резервные копии файла базы: ручной запуск, отмена, перечень и запуск по расписанию.
 *
 * Сервис держит состояние процесса: идущие копии, итог последней копии и плановый цикл.
 * Настройки читаются из основной базы, а снимок пишет рабочий поток с собственным соединением:
 * обработка запросов во время копирования не останавливается.
 */
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(BackupService.name);
    private readonly running = new Map<string, RunningEntry>();
    private lastOutcome: BackupOutcome | null = null;
    private scheduleFiber: Fiber.Fiber<unknown, unknown> | undefined;

    constructor(private readonly settings: SettingsService, private readonly database: DatabaseService) {}

    /** Начальные значения применяются, пока в базе нет сохранённой настройки. */
    get initialSettings() { return this.settings.backup; }

    /**
     * Запускает плановый цикл после всех `onModuleInit`, то есть после синхронизации структуры базы:
     * первая копия получает уже готовую структуру. Недоступный каталог запуск не останавливает:
     * им может быть отключённый диск, и ошибка видна в логе и на странице копий.
     */
    onApplicationBootstrap(): void {
        const directory = this.settings.backup.directory;
        if (directory === undefined) return;
        const prepare = ensureBackupDirectory(directory).pipe(
            Effect.andThen(removePartialBackups(directory)),
            Effect.catch((error) => Effect.sync(() => this.logger.warn(error.message))),
        );
        this.scheduleFiber = Effect.runFork(prepare.pipe(Effect.andThen(this.scheduleLoop(directory)), Effect.provideService(Database, this.database.effect)));
    }

    /**
     * Прерывает цикл и идущие копии до закрытия соединения в `DatabaseService`. Прерывание
     * завершает рабочие потоки и удаляет недописанные файлы.
     */
    async onModuleDestroy(): Promise<void> {
        const fibers = [this.scheduleFiber, ...[...this.running.values()].map((entry) => entry.fiber)].filter((fiber) => fiber !== undefined);
        await Effect.runPromise(Effect.forEach(fibers, (fiber) => Fiber.interrupt(fiber), { concurrency: 'unbounded', discard: true }));
    }

    /** Состояние для страницы. Ошибка чтения каталога не скрывает идущие копии и расписание. */
    overview(canWrite: boolean): Effect.Effect<BackupOverview, DatabaseError, Database> {
        return Effect.gen({ self: this }, function* () {
            const { directory } = this.settings.backup;
            const { schedule, keep } = yield* readBackupSettings(this.settings.backup);
            const running = [...this.running.values()].map((entry) => entry.information);
            const base = {
                directory: directory ?? null, running, limit: runningLimit, schedule, keep, lastOutcome: this.lastOutcome,
                nextRun: nextDue(parseSchedule(schedule), new Date())?.toISOString() ?? null, canWrite,
            };
            if (directory === undefined) return { ...base, available: false, disk: null, directoryError: null, files: [] };
            return yield* Effect.all({ disk: diskUsage(directory), files: listBackups(directory) }).pipe(
                Effect.map(({ disk, files }) => ({ ...base, available: true, disk, files, directoryError: null })),
                Effect.catch((error) => Effect.succeed({ ...base, available: true, disk: null, files: [], directoryError: error.message })),
            );
        });
    }

    /**
     * Начинает копию в фоне и сразу возвращает её описание: запрос не ждёт окончания копирования.
     * Третья одновременная копия отклоняется. Проверка и регистрация копии выполняются в одном
     * синхронном шаге, поэтому два одновременных запроса не превысят предел.
     */
    start(source: BackupSource, id: string): Effect.Effect<RunningBackup, DataPolicyError | DatabaseError, Database> {
        return Effect.gen({ self: this }, function* () {
            const directory = this.settings.backup.directory;
            const database = this.settings.database;
            if (directory === undefined || database.kind !== 'file') {
                return yield* new DataPolicyError({ message: 'Резервное копирование недоступно: база открыта в памяти' });
            }
            const { keep } = yield* readBackupSettings(this.settings.backup);
            if (this.running.size >= runningLimit) {
                return yield* new DataPolicyError({ message: `Уже идут ${runningLimit} копии; дождитесь окончания одной из них` });
            }
            const startedAt = new Date();
            const entry: RunningEntry = { information: { id, source, startedAt: startedAt.toISOString(), cancelling: false }, fiber: undefined };
            this.running.set(id, entry);
            const work = writeBackup(database.path, directory, keep, source, startedAt).pipe(
                Effect.tap((file) => this.finish({ kind: 'succeeded', source, file, message: null })),
                Effect.tapError((error) => this.finish({ kind: 'failed', source, file: null, message: error.message })),
                Effect.onInterrupt(() => this.finish({ kind: 'cancelled', source, file: null, message: null })),
                Effect.ensuring(Effect.sync(() => this.running.delete(id))),
            );
            // Копия не принадлежит запросу: прерывание или конец запроса её не останавливают.
            entry.fiber = yield* Effect.forkDetach(work);
            return entry.information;
        });
    }

    /** Прерывает копию. Ответ приходит сразу, а копия исчезает из списка после остановки потока. */
    cancel(id: string): Effect.Effect<void, DataNotFoundError> {
        return Effect.gen({ self: this }, function* () {
            const entry = this.running.get(id);
            if (entry?.fiber === undefined) return yield* new DataNotFoundError({ message: 'Копия не идёт: она уже закончилась или не начиналась' });
            entry.information = { ...entry.information, cancelling: true };
            yield* Effect.forkDetach(Fiber.interrupt(entry.fiber));
        });
    }

    /** Запоминает итог копии для страницы и пишет его в лог сервера. */
    private finish(outcome: Omit<BackupOutcome, 'finishedAt'>): Effect.Effect<void> {
        return Effect.sync(() => {
            this.lastOutcome = { ...outcome, finishedAt: new Date().toISOString() };
            if (outcome.kind === 'succeeded') this.logger.log(`Резервная копия записана: ${outcome.file}`);
            else if (outcome.kind === 'failed') this.logger.error(`Резервная копия не записана: ${outcome.message}`);
            else this.logger.warn('Резервная копия отменена');
        });
    }

    /**
     * Плановый цикл. Срок запускает копию, если он позже последнего обработанного. При запуске
     * последним обработанным считается время новейшей копии в каталоге: срок, пропущенный, пока
     * сервер был остановлен или компьютер спал, догоняется одной копией. Несколько пропущенных
     * сроков тоже дают одну копию, потому что берётся только последний из них.
     */
    private scheduleLoop(directory: string): Effect.Effect<never, never, Database> {
        return Effect.gen({ self: this }, function* () {
            const files = yield* listBackups(directory).pipe(Effect.orElseSucceed(() => []));
            let lastHandled = files[0] === undefined ? 0 : new Date(files[0].createdAt).getTime();
            while (true) {
                // Чтение вне запроса видит только подтверждённую настройку. Ошибка чтения не
                // останавливает цикл и не подменяет сохранённое расписание значениями файла.
                const current = yield* readBackupSettings(this.settings.backup).pipe(
                    Effect.catch((error) => Effect.sync(() => { this.logger.warn(String(error)); return undefined; })),
                );
                if (current === undefined) { yield* Effect.sleep(checkInterval); continue; }
                const now = new Date();
                const crons = parseSchedule(current.schedule);
                // Сохраняем последний обработанный срок, а новые строки не догоняют время до записи.
                if (current.updatedAt !== null) lastHandled = Math.max(lastHandled, new Date(current.updatedAt).getTime());
                const due = latestDue(crons, now);
                if (due !== undefined && due.getTime() > lastHandled) {
                    // Срок отмечается до запуска: отказ из-за двух идущих копий или ошибка копии
                    // не повторяются каждые 30 секунд, а ждут следующего срока.
                    lastHandled = due.getTime();
                    yield* this.start('schedule', newGuid()).pipe(
                        Effect.catch((error) => Effect.sync(() => this.logger.warn(`Плановая копия за ${due.toLocaleString()} не начата: ${error.message}`))),
                    );
                }
                yield* Effect.sleep(checkInterval);
            }
        });
    }
}
