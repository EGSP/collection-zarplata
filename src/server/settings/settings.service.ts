import { Injectable } from '@nestjs/common';
import path from 'node:path';

/**
 * Настройки запуска. Пока читаются из переменных окружения со значениями по умолчанию;
 * позже источником станет файл настроек рядом с исполняемым файлом.
 */
@Injectable()
export class SettingsService {
    readonly host = process.env['HOST'] ?? '127.0.0.1';
    readonly port = Number(process.env['PORT'] ?? 3000);
    readonly databasePath = path.resolve(process.env['DATABASE_PATH'] ?? 'data/collection-zarplata.db');
    /** Собранный клиент: dist/web рядом с dist/server. */
    readonly webRootPath = path.resolve(import.meta.dirname, '../../web');
}
