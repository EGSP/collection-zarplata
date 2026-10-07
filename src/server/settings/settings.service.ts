import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isSea } from 'node:sea';
import { LaunchArguments, pinPattern, portValue } from './launch-arguments.js';

const settingsFileName = 'collection-zarplata.settings.json';

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

interface Settings {
    readonly host: string;
    readonly port: number;
    readonly database: DatabaseLocation;
    readonly pinHmacSecret: string;
    readonly initialUsers: ReadonlyArray<InitialUser>;
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
    };
}

/**
 * Настройки режима памяти не читают файл: у агента в новом worktree его нет. Секрет создаётся
 * при запуске, потому что токены и хеши PIN живут не дольше процесса вместе с базой.
 */
function memorySettings(launch: LaunchArguments): Settings {
    return {
        host: '127.0.0.1',
        port: memoryDefaultPort,
        database: { kind: 'memory' },
        pinHmacSecret: randomBytes(32).toString('hex'),
        initialUsers: launch.testUsers.map((user) => ({
            name: user.roles === undefined ? 'Тестовый пользователь' : `Тестовый пользователь (${user.roles.join(', ')})`,
            pin: user.pin,
            roles: user.roles,
        })),
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
    if (launch.database === 'memory') return memorySettings(launch);
    return readSettingsFile(isSea() ? path.dirname(process.execPath) : process.cwd());
}

/**
 * Настройки запуска. Обычно они читаются из файла JSON рядом с исполняемым файлом или в корне
 * проекта при разработке; ошибка в файле останавливает запуск. Параметр `--database=memory`
 * запускает приложение на пустой базе в памяти без файла настроек, а `--test-pin` создаёт в ней
 * тестовых пользователей. Порт из настроек может заменить параметр `--port`: порт, который
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
    /** Срок access-токена и его cookie: `ACCESS_TOKEN_LIFETIME_SECONDS`, по умолчанию 15 минут. */
    readonly accessTokenLifetimeSeconds = lifetimeSeconds('ACCESS_TOKEN_LIFETIME_SECONDS', 15 * 60);
    /** Срок refresh-токена и его cookie: `REFRESH_TOKEN_LIFETIME_SECONDS`, по умолчанию семь дней. */
    readonly refreshTokenLifetimeSeconds = lifetimeSeconds('REFRESH_TOKEN_LIFETIME_SECONDS', 7 * 24 * 60 * 60);
    readonly webRootPath = isSea() ? '' : path.resolve(import.meta.dirname, '../../web');

    constructor(@Inject(LaunchArguments) launch: LaunchArguments) {
        this.settings = readSettings(launch);
        this.host = this.settings.host;
        this.port = this.settings.port;
        this.database = this.settings.database;
        this.pinHmacSecret = this.settings.pinHmacSecret;
        this.initialUsers = this.settings.initialUsers;
    }
}
