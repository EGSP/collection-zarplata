/**
 * Описания резервного копирования, которые сервер отдаёт странице «Резервные копии».
 * Файл не импортирует Nest и Effect: его типы использует и клиент.
 */

/** Как начата копия: по строке расписания или кнопкой и запросом к API. */
export type BackupSource = 'schedule' | 'manual';

/** Готовая копия в каталоге `backups`. Время создания берётся из имени файла. */
export interface BackupFile {
    readonly name: string;
    /** Размер файла в байтах. */
    readonly size: number;
    readonly createdAt: string;
    readonly source: BackupSource;
}

/** Копия, которую сейчас пишет рабочий поток. */
export interface RunningBackup {
    readonly id: string;
    readonly source: BackupSource;
    readonly startedAt: string;
    /**
     * Отмена запрошена, но рабочий поток ещё не остановился. Драйвер не прерывает начатый шаг
     * копирования, поэтому на большой базе отмена вступает в силу не сразу.
     */
    readonly cancelling: boolean;
}

/** Чем закончилась последняя копия с момента запуска сервера. */
export interface BackupOutcome {
    readonly kind: 'succeeded' | 'failed' | 'cancelled';
    readonly source: BackupSource;
    readonly finishedAt: string;
    /** Имя файла успешной копии. */
    readonly file: string | null;
    /** Текст ошибки неудачной копии. */
    readonly message: string | null;
}

/** Место на диске с каталогом копий, в байтах. */
export interface DiskUsage {
    readonly total: number;
    readonly used: number;
    readonly free: number;
}

/** Состояние копирования для страницы: диск, копии, идущие копии и расписание. */
export interface BackupOverview {
    /** `false` у базы в памяти: копировать нечего. Расписание остаётся доступно через API. */
    readonly available: boolean;
    readonly directory: string | null;
    readonly disk: DiskUsage | null;
    /** Почему не удалось прочитать каталог или место на диске. */
    readonly directoryError: string | null;
    readonly files: ReadonlyArray<BackupFile>;
    readonly running: ReadonlyArray<RunningBackup>;
    /** Сколько копий может идти одновременно. */
    readonly limit: number;
    readonly schedule: ReadonlyArray<string>;
    /** Ближайший срок плановой копии; `null` без расписания. */
    readonly nextRun: string | null;
    /** Сколько последних копий хранится. */
    readonly keep: number;
    readonly lastOutcome: BackupOutcome | null;
    /** Может ли пользователь создавать и прерывать копии, менять расписание и число копий. */
    readonly canWrite: boolean;
}
