import type { FactoryProvider } from '@nestjs/common';

/**
 * Параметры командной строки, которые меняют запуск приложения. Их разбирает отдельный провайдер,
 * чтобы настройки и порт сервера получали готовые значения и не читали `process.argv` сами.
 */
export interface LaunchArguments {
    /**
     * `file` — рабочая база по файлу настроек. `memory` открывает пустую базу в памяти без файла
     * настроек. `test` работает как `memory`, но хранит базу в файле `testDatabasePath`:
     * данные и тестовые пользователи сохраняются между запусками проверки.
     */
    readonly database: 'file' | 'memory' | 'test';
    /** Файл тестовой базы из параметра `--test-database`; задан только при `database: 'test'`. */
    readonly testDatabasePath: string | undefined;
    /** Порт сервера вместо порта из настроек. */
    readonly port: number | undefined;
    /** Тестовые пользователи, которых режим памяти создаёт при запуске. */
    readonly testUsers: ReadonlyArray<TestUser>;
    /**
     * PIN тестового пользователя, от имени которого сервер входит сам, когда у браузера нет сессии:
     * параметр `--auto-login-pin` или переменная окружения `AUTO_LOGIN_PIN`.
     */
    readonly autoLoginPin: string | undefined;
    /**
     * Строки расписания резервного копирования из повторяемого параметра `--test-backup-schedule`.
     * Нужны, чтобы проверить копирование по расписанию на тестовой базе без файла настроек.
     */
    readonly testBackupSchedule: ReadonlyArray<string>;
}

/** Тестовый пользователь из параметра `--test-pin`. */
export interface TestUser {
    readonly pin: string;
    /** Имена ролей из параметра; `undefined` — параметр задал только PIN, и пользователь получает все роли. */
    readonly roles: ReadonlyArray<string> | undefined;
}

/** Токен разобранных параметров запуска. */
export const LaunchArguments = Symbol('LaunchArguments');

/** PIN пользователя: от 4 до 12 цифр. */
export const pinPattern = /^[0-9]{4,12}$/;

/**
 * Значение `--test-pin`: PIN и необязательный список ролей через запятую, например `111111:reader`.
 * Существование ролей здесь не проверяется: их знает конфигурация, и неизвестную роль отклоняет создание пользователя.
 */
const testUserPattern = /^([0-9]{4,12})(?::([A-Za-z0-9]+(?:,[A-Za-z0-9]+)*))?$/;

/** Проверяет, что значение — допустимый номер порта TCP. */
export function portValue(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

/**
 * Разбирает параметры запуска вида `--имя=значение`. Неизвестный параметр останавливает запуск:
 * опечатка в `--database=memory` иначе незаметно открыла бы рабочую базу.
 *
 * PIN автовхода можно задать и переменной окружения, чтобы не повторять его в каждой команде
 * проверки; параметр командной строки важнее переменной.
 */
function readArguments(values: readonly string[], autoLoginVariable: string | undefined): LaunchArguments {
    let database: LaunchArguments['database'] = 'file';
    let testDatabasePath: string | undefined;
    let port: number | undefined;
    const testUsers: TestUser[] = [];
    const testBackupSchedule: string[] = [];
    let autoLoginPin = autoLoginVariable === '' ? undefined : autoLoginVariable;
    if (autoLoginPin !== undefined && !pinPattern.test(autoLoginPin)) {
        throw new Error(`Переменная окружения AUTO_LOGIN_PIN должна содержать PIN из 4–12 цифр, получено «${autoLoginPin}»`);
    }
    for (const argument of values) {
        const match = /^--([a-z-]+)=(.*)$/.exec(argument);
        const name = match?.[1];
        const value = match?.[2] ?? '';
        if (name === 'database' && (value === 'file' || value === 'memory')) {
            database = value;
        } else if (name === 'test-database' && value.trim() !== '') {
            database = 'test';
            testDatabasePath = value;
        } else if (name === 'port' && /^[0-9]+$/.test(value) && portValue(Number(value))) {
            port = Number(value);
        } else if (name === 'test-pin' && testUserPattern.test(value)) {
            const [, pin, roles] = testUserPattern.exec(value)!;
            // PIN однозначно определяет пользователя, поэтому второй пользователь с тем же PIN не смог бы войти.
            if (testUsers.some((user) => user.pin === pin)) throw new Error(`Параметр --test-pin повторяет PIN ${pin}: у каждого тестового пользователя должен быть свой PIN`);
            testUsers.push({ pin: pin!, roles: roles?.split(',') });
        } else if (name === 'auto-login-pin' && pinPattern.test(value)) {
            autoLoginPin = value;
        } else if (name === 'test-backup-schedule' && value.trim() !== '') {
            // Строку cron проверяют настройки вместе со строками из файла: правило разбора одно.
            testBackupSchedule.push(value.trim());
        } else if (name === 'database' || name === 'test-database' || name === 'port' || name === 'test-pin' || name === 'auto-login-pin' || name === 'test-backup-schedule') {
            throw new Error(`Неверное значение параметра запуска ${argument}: ожидается --database=file|memory, --test-database=<файл>, --port=1…65535, --test-pin из 4–12 цифр с необязательными ролями (--test-pin=111111:reader), --auto-login-pin из 4–12 цифр или --test-backup-schedule=<строка cron>`);
        } else {
            throw new Error(`Неизвестный параметр запуска ${argument}. Допустимы --database, --test-database, --port, --test-pin, --auto-login-pin и --test-backup-schedule`);
        }
    }
    // Режим определяет последний из параметров выбора базы, поэтому после --database=file
    // или --database=memory файл тестовой базы не действует.
    if (database !== 'test') testDatabasePath = undefined;
    if (testUsers.length > 0 && database === 'file') {
        // Тестовый PIN в рабочей базе создал бы постоянного пользователя с PIN из командной строки.
        throw new Error('Параметр --test-pin допустим только вместе с --database=memory или --test-database');
    }
    if (autoLoginPin !== undefined && database === 'file') {
        // Автовход в рабочей базе пускал бы в приложение любого, кто откроет его адрес.
        throw new Error('Автовход (--auto-login-pin или AUTO_LOGIN_PIN) допустим только вместе с --database=memory или --test-database');
    }
    if (autoLoginPin !== undefined && !testUsers.some((user) => user.pin === autoLoginPin)) {
        throw new Error(`PIN автовхода ${autoLoginPin} должен совпадать с PIN одного из параметров --test-pin`);
    }
    if (testBackupSchedule.length > 0 && database !== 'test') {
        // Копировать базу в памяти нечем, а рабочей базе расписание задаёт файл настроек.
        throw new Error('Параметр --test-backup-schedule допустим только вместе с --test-database');
    }
    return { database, testDatabasePath, port, testUsers, autoLoginPin, testBackupSchedule };
}

/** Разбирает параметры процесса один раз при сборке приложения; ошибка останавливает запуск. */
export const launchArgumentsProvider: FactoryProvider<LaunchArguments> = {
    provide: LaunchArguments,
    // В исполняемом файле Node ставит путь к нему на место пути к скрипту, поэтому параметры начинаются с третьего элемента и там.
    useFactory: () => readArguments(process.argv.slice(2), process.env['AUTO_LOGIN_PIN']),
};
