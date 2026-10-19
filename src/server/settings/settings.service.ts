import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isSea } from 'node:sea';
import { Cron, Result } from 'effect';
import { LaunchArguments, pinPattern, portValue } from './launch-arguments.js';

const settingsFileName = 'collection-zarplata.settings.json';

/** Каталог резервных копий рядом с исполняемым файлом или файлом настроек; имя не настраивается. */
const backupDirectoryName = 'backups';

/** Сколько копий хранить, если в настройках не указано `backup.keep`. */
const defaultBackupKeep = 30;

/** Порт режима памяти по умолчанию: он не совпадает с портом 3000, на который Vite направляет `/api` в режиме разработки. */
const memoryDefaultPort = 3100;

/**
 * Где хранится база. Файл сохраняет данные между запусками; база в памяти пуста при каждом
 * запуске и исчезает после остановки процесса.
 */
export type DatabaseLocation =
    | { readonly kind: 'file'; readonly path: string }
    | { readonly kind: 'memory' };

/** Пользователь, которого сервер создаёт при запуске в пустой таблице пользователей. */
export interface InitialUser {
    readonly name: string;
    readonly pin: string;
    /** Имена ролей пользователя. Без них пользователь получает все роли конфигурации. */
    readonly roles: ReadonlyArray<string> | undefined;
}

/**
 * Резервное копирование файла базы. Каталог задаёт платформа, а не администратор: копии всегда
 * лежат в `backups` рядом с приложением, и их легко найти при восстановлении.
 */
export interface BackupSettings {
    /** Каталог копий; `undefined` у базы в памяти: копировать нечего, и копирование недоступно. */
    readonly directory: string | undefined;
    /** Строки cron, по которым делаются плановые копии. Пустой список оставляет только ручные копии. */
    readonly schedule: ReadonlyArray<string>;
    /** Сколько последних копий хранить; более старые удаляются после каждой успешной копии. */
    readonly keep: number;
}

/** Настройки первичных данных: демонстрационные сотрудники включаются только явно. */
interface InitialDataSettings {
    readonly createRandomEmployees: boolean;
}

interface Settings {
    readonly host: string;
    readonly port: number;
    readonly database: DatabaseLocation;
    readonly pinHmacSecret: string;
    readonly initialUsers: ReadonlyArray<InitialUser>;
    readonly initialData: InitialDataSettings;
    readonly backup: BackupSettings;
}

/**
 * Проверяет строки расписания разбором cron из Effect, тем же, что потом вычисляет сроки копий.
 * Ошибка называет строку: иначе опечатка незаметно оставила бы базу без плановых копий.
 */
function backupSchedule(value: unknown, source: string): ReadonlyArray<string> {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((line) => typeof line !== 'string')) {
        throw new Error(`${source}: backup.schedule должен быть списком строк cron`);
    }
    for (const line of value as string[]) {
        const parsed = Cron.parse(line);
        if (Result.isFailure(parsed)) throw new Error(`${source}: строка расписания «${line}» не разобрана: ${parsed.failure.message}`);
    }
    return value as string[];
}

/** Читает необязательный блок `backup` файла настроек: расписание и число хранимых копий. */
function readBackupSettings(value: unknown, directory: string, filePath: string): BackupSettings {
    const source = `В файле настроек ${filePath}`;
    if (value === undefined) return { directory: path.join(directory, backupDirectoryName), schedule: [], keep: defaultBackupKeep };
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${source} backup должен быть объектом`);
    const backup = value as Record<string, unknown>;
    const keep = backup['keep'] ?? defaultBackupKeep;
    if (!Number.isInteger(keep) || (keep as number) < 1) throw new Error(`${source} backup.keep должен быть целым числом не меньше 1`);
    return { directory: path.join(directory, backupDirectoryName), schedule: backupSchedule(backup['schedule'], source), keep: keep as number };
}

/** Необязательный блок инициализации. Строка «false» не принимается вместо логического значения. */
function readInitialDataSettings(value: unknown, filePath: string): InitialDataSettings {
    if (value === undefined) return { createRandomEmployees: false };
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`В файле настроек ${filePath} initialData должен быть объектом`);
    }
    const createRandomEmployees = (value as Record<string, unknown>)['createRandomEmployees'];
    if (createRandomEmployees !== undefined && typeof createRandomEmployees !== 'boolean') {
        throw new Error(`В файле настроек ${filePath} initialData.createRandomEmployees должен быть логическим значением`);
    }
    return { createRandomEmployees: createRandomEmployees ?? false };
}

function readSettingsFile(directory: string): Settings {
    const filePath = path.join(directory, settingsFileName);
    let value: unknown;

    try {
        value = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (error) {
        throw new Error(`Не удалось прочитать файл настроек ${filePath}: ${String(error)}`);
    }

    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`Файл настроек ${filePath} должен содержать объект JSON`);
    }

    const settings = value as Record<string, unknown>;
    if (typeof settings['host'] !== 'string' || settings['host'].trim() === '') {
        throw new Error(`В файле настроек ${filePath} нужен непустой адрес host`);
    }
    if (!portValue(settings['port'])) {
        throw new Error(`В файле настроек ${filePath} порт port должен быть целым числом от 1 до 65535`);
    }
    if (typeof settings['databasePath'] !== 'string' || settings['databasePath'].trim() === '') {
        throw new Error(`В файле настроек ${filePath} нужен непустой путь databasePath`);
    }
    if (typeof settings['pinHmacSecret'] !== 'string' || settings['pinHmacSecret'].length < 32) {
        throw new Error(`В файле настроек ${filePath} секрет pinHmacSecret должен содержать не меньше 32 символов`);
    }
    const initialUser = settings['initialUser'];
    if (initialUser !== undefined && (typeof initialUser !== 'object' || initialUser === null || Array.isArray(initialUser)
        || typeof (initialUser as Record<string, unknown>)['name'] !== 'string'
        || !(initialUser as { name: string }).name.trim()
        || typeof (initialUser as Record<string, unknown>)['pin'] !== 'string'
        || !pinPattern.test((initialUser as { pin: string }).pin))) {
        throw new Error(`В файле настроек ${filePath} initialUser должен содержать имя и PIN из 4–12 цифр`);
    }
    const roles = (initialUser as Record<string, unknown> | undefined)?.['roles'];
    if (roles !== undefined && (!Array.isArray(roles) || roles.some((role) => typeof role !== 'string'))) {
        throw new Error(`В файле настроек ${filePath} initialUser.roles должен быть списком имён ролей`);
    }

    return {
        host: settings['host'],
        port: settings['port'],
        database: { kind: 'file', path: path.resolve(directory, settings['databasePath']) },
        pinHmacSecret: settings['pinHmacSecret'],
        initialUsers: initialUser === undefined ? [] : [{
            name: (initialUser as { name: string }).name,
            pin: (initialUser as { pin: string }).pin,
            roles: roles as ReadonlyArray<string> | undefined,
        }],
        backup: readBackupSettings(settings['backup'], directory, filePath),
        initialData: readInitialDataSettings(settings['initialData'], filePath),
    };
}

/**
 * Секрет тестовой файловой базы. Хеши PIN и подписи токенов в файле переживают перезапуск,
 * поэтому секрет тоже должен сохраняться: он лежит рядом с базой в файле `<база>.secret`
 * и создаётся при первом запуске. Новый секрет сделал бы невозможным вход сохранённых пользователей.
 */
function testDatabaseSecret(databasePath: string): string {
    const secretPath = `${databasePath}.secret`;
    try {
        return readFileSync(secretPath, 'utf8').trim();
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const secret = randomBytes(32).toString('hex');
    mkdirSync(path.dirname(secretPath), { recursive: true });
    writeFileSync(secretPath, secret, { flag: 'wx' });
    return secret;
}

/**
 * Настройки тестовых режимов не читают файл настроек: у агента в новом worktree его нет.
 * В режиме памяти секрет создаётся при запуске, потому что токены и хеши PIN живут не дольше
 * процесса вместе с базой. Тестовая файловая база хранит секрет рядом с собой.
 */
function testSettings(launch: LaunchArguments): Settings {
    const databasePath = launch.testDatabasePath === undefined ? undefined : path.resolve(launch.testDatabasePath);
    return {
        host: '127.0.0.1',
        port: memoryDefaultPort,
        database: databasePath === undefined ? { kind: 'memory' } : { kind: 'file', path: databasePath },
        pinHmacSecret: databasePath === undefined ? randomBytes(32).toString('hex') : testDatabaseSecret(databasePath),
        initialUsers: launch.testUsers.map((user) => ({
            name: user.roles === undefined ? 'Тестовый пользователь' : `Тестовый пользователь (${user.roles.join(', ')})`,
            pin: user.pin,
            roles: user.roles,
        })),
        // Изолированные тестовые режимы сохраняют демонстрационное заполнение без файла настроек.
        initialData: { createRandomEmployees: true },
        // Копии тестовой базы лежат рядом с её файлом, а не в каталоге проекта.
        backup: {
            directory: databasePath === undefined ? undefined : path.join(path.dirname(databasePath), backupDirectoryName),
            schedule: backupSchedule(launch.testBackupSchedule, 'Параметр --test-backup-schedule'),
            keep: defaultBackupKeep,
        },
    };
}

/**
 * Срок действия токена в секундах из переменной окружения. Без переменной действует значение
 * по умолчанию; значение, которое не является положительным целым числом, останавливает запуск:
 * опечатка иначе незаметно выдала бы токены с неожиданным сроком.
 */
function lifetimeSeconds(variable: string, fallback: number): number {
    const value = process.env[variable];
    if (value === undefined || value === '') return fallback;
    if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error(`Переменная окружения ${variable} должна быть положительным целым числом секунд, получено «${value}»`);
    }
    return Number(value);
}

function readSettings(launch: LaunchArguments): Settings {
    if (launch.database !== 'file') return testSettings(launch);
    return readSettingsFile(isSea() ? path.dirname(process.execPath) : process.cwd());
}

/**
 * Настройки запуска. Обычно они читаются из файла JSON рядом с исполняемым файлом или в корне
 * проекта при разработке; ошибка в файле останавливает запуск. Параметр `--database=memory`
 * запускает приложение на пустой базе в памяти без файла настроек, `--test-database` — так же,
 * но на базе в указанном файле, а `--test-pin` создаёт в них тестовых пользователей. Порт из настроек может заменить параметр `--port`: порт, который
 * слушает сервер, выбирает провайдер `ServerPort`. Сроки действия токенов в любом режиме задают
 * переменные окружения: короткие сроки нужны, чтобы проверить обновление токенов, не дожидаясь
 * настоящего истечения.
 */
@Injectable()
export class SettingsService {
    private readonly settings: Settings;
    readonly host: string;
    /** Порт из файла настроек или порт режима памяти по умолчанию; сервер слушает порт из `ServerPort`. */
    readonly port: number;
    readonly database: DatabaseLocation;
    readonly pinHmacSecret: string;
    /** Первый пользователь из файла настроек либо тестовые пользователи режима памяти. */
    readonly initialUsers: ReadonlyArray<InitialUser>;
    /** Параметры заполнения новой базы из initialData файла настроек. */
    readonly initialData: InitialDataSettings;
    /** Каталог, расписание и число хранимых резервных копий. */
    readonly backup: BackupSettings;
    /** PIN тестового пользователя для автовхода; бывает только в тестовых режимах. */
    readonly autoLoginPin: string | undefined;
    /** Срок access-токена и его cookie: `ACCESS_TOKEN_LIFETIME_SECONDS`, по умолчанию 15 минут. */
    readonly accessTokenLifetimeSeconds = lifetimeSeconds('ACCESS_TOKEN_LIFETIME_SECONDS', 15 * 60);
    /** Срок refresh-токена и его cookie: `REFRESH_TOKEN_LIFETIME_SECONDS`, по умолчанию семь дней. */
    readonly refreshTokenLifetimeSeconds = lifetimeSeconds('REFRESH_TOKEN_LIFETIME_SECONDS', 7 * 24 * 60 * 60);
    readonly webRootPath = isSea() ? '' : path.resolve(import.meta.dirname, '../../web');
    /** Каталог собранного сайта документации. В исполняемом файле сайт лежит в ресурсах, и путь не используется. */
    readonly documentationRootPath = isSea() ? '' : path.resolve(import.meta.dirname, '../../docs');

    constructor(@Inject(LaunchArguments) launch: LaunchArguments) {
        this.settings = readSettings(launch);
        this.host = this.settings.host;
        this.port = this.settings.port;
        this.database = this.settings.database;
        this.pinHmacSecret = this.settings.pinHmacSecret;
        this.initialUsers = this.settings.initialUsers;
        this.initialData = this.settings.initialData;
        this.backup = this.settings.backup;
        this.autoLoginPin = launch.autoLoginPin;
        // Предупреждение видно в журнале запуска: без него вход без PIN выглядел бы как ошибка прав.
        if (this.database.kind === 'file' && launch.database === 'test') {
            new Logger('Settings').warn(`Тестовая база в файле ${this.database.path}: данные сохраняются между запусками`);
        }
        if (this.autoLoginPin !== undefined) {
            new Logger('Settings').warn(`Включён автовход: браузер без сессии входит по PIN ${this.autoLoginPin}`);
        }
    }
}
