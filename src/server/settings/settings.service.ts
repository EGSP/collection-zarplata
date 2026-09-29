import { Injectable } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isSea } from 'node:sea';

const settingsFileName = 'collection-zarplata.settings.json';

interface SettingsFile {
    host: string;
    port: number;
    databasePath: string;
    pinHmacSecret: string;
    initialUser: { name: string; pin: string } | undefined;
}

function readSettings(): SettingsFile {
    const directory = isSea() ? path.dirname(process.execPath) : process.cwd();
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
    if (!Number.isInteger(settings['port']) || (settings['port'] as number) < 1 || (settings['port'] as number) > 65535) {
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
        || !/^[0-9]{4,12}$/.test((initialUser as { pin: string }).pin))) {
        throw new Error(`В файле настроек ${filePath} initialUser должен содержать имя и PIN из 4–12 цифр`);
    }

    return {
        host: settings['host'],
        port: settings['port'] as number,
        databasePath: path.resolve(directory, settings['databasePath']),
        pinHmacSecret: settings['pinHmacSecret'],
        initialUser: initialUser as SettingsFile['initialUser'],
    };
}

/** Настройки берутся из JSON рядом с исполняемым файлом либо из корня проекта при разработке. */
@Injectable()
export class SettingsService {
    private readonly settings = readSettings();
    readonly host = this.settings.host;
    readonly port = this.settings.port;
    readonly databasePath = this.settings.databasePath;
    readonly pinHmacSecret = this.settings.pinHmacSecret;
    readonly initialUser = this.settings.initialUser;
    readonly webRootPath = isSea() ? '' : path.resolve(import.meta.dirname, '../../web');
}
