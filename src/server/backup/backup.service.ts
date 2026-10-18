import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { Duration, Effect, Fiber } from 'effect';
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
 * Сами копии пишет рабочий поток с собственным соединением, поэтому сервис не зависит
 * от `DatabaseService`, а обработка запросов во время копирования не останавливается.
 */
@Injectable()
export class BackupService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(BackupService.name);
    private readonly running = new Map<string, RunningEntry>();
    private readonly crons;
    private lastOutcome: BackupOutcome | null = null;
    private nextRun: Date | undefined;
    private scheduleFiber: Fiber.Fiber<unknown, unknown> | undefined;

    constructor(private readonly settings: SettingsService) {
        this.crons = parseSchedule(settings.backup.schedule);
    }

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
        this.scheduleFiber = Effect.runFork(this.crons.length === 0 ? prepare : prepare.pipe(Effect.andThen(this.scheduleLoop(directory))));
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
    overview(canWrite: boolean): Effect.Effect<BackupOverview> {
        const { directory, schedule, keep } = this.settings.backup;
        const running = [...this.running.values()].map((entry) => entry.information);
        const base = {
            directory: directory ?? null, running, limit: runningLimit, schedule, keep, lastOutcome: this.lastOutcome,
            nextRun: this.nextRun?.toISOString() ?? nextDue(this.crons, new Date())?.toISOString() ?? null, canWrite,
        };
        if (directory === undefined) return Effect.succeed({ ...base, available: false, disk: null, directoryError: null, files: [] });
        return Effect.all({ disk: diskUsage(directory), files: listBackups(directory) }).pipe(
            Effect.map(({ disk, files }) => ({ ...base, available: true, disk, files, directoryError: null })),
            Effect.catch((error) => Effect.succeed({ ...base, available: true, disk: null, files: [], directoryError: error.message })),
        );
    }

    /**
     * Начинает копию в фоне и сразу возвращает её описание: запрос не ждёт окончания копирования.
     * Третья одновременная копия отклоняется. Проверка и регистрация копии выполняются в одном
     * синхронном шаге, поэтому два одновременных запроса не превысят предел.
     */
    start(source: BackupSource, id: string): Effect.Effect<RunningBackup, DataPolicyError> {
        return Effect.gen({ self: this }, function* () {
            const directory = this.settings.backup.directory;
            const database = this.settings.database;
            if (directory === undefined || database.kind !== 'file') {
                return yield* new DataPolicyError({ message: 'Резервное копирование недоступно: база открыта в памяти' });
            }
            if (this.running.size >= runningLimit) {
                return yield* new DataPolicyError({ message: `Уже идут ${runningLimit} копии; дождитесь окончания одной из них` });
            }
            const startedAt = new Date();
            const entry: RunningEntry = { information: { id, source, startedAt: startedAt.toISOString(), cancelling: false }, fiber: undefined };
            this.running.set(id, entry);
            const work = writeBackup(database.path, directory, this.settings.backup.keep, source, startedAt).pipe(
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
    private scheduleLoop(directory: string): Effect.Effect<never> {
        return Effect.gen({ self: this }, function* () {
            const files = yield* listBackups(directory).pipe(Effect.orElseSucceed(() => []));
            let lastHandled = files[0] === undefined ? 0 : new Date(files[0].createdAt).getTime();
            while (true) {
                const now = new Date();
                const due = latestDue(this.crons, now);
                if (due !== undefined && due.getTime() > lastHandled) {
                    // Срок отмечается до запуска: отказ из-за двух идущих копий или ошибка копии
                    // не повторяются каждые 30 секунд, а ждут следующего срока.
                    lastHandled = due.getTime();
                    yield* this.start('schedule', newGuid()).pipe(
                        Effect.catch((error) => Effect.sync(() => this.logger.warn(`Плановая копия за ${due.toLocaleString()} не начата: ${error.message}`))),
                    );
                }
                this.nextRun = nextDue(this.crons, now);
                yield* Effect.sleep(checkInterval);
            }
        });
    }
}
