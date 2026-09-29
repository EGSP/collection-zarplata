import { Logger, type FactoryProvider } from '@nestjs/common';
import { connect, type Database } from '@tursodatabase/database';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SettingsService } from '../settings/settings.service.js';

/** Токен соединения Turso, которое получает `DatabaseService`. */
export const DatabaseConnection = Symbol('DatabaseConnection');

/**
 * Открывает соединение по настройкам запуска: файл базы или пустую базу в памяти.
 *
 * Выбор сделан фабрикой провайдера, а не условием внутри сервиса: сервисы, работающие с базой,
 * получают одинаковое соединение и о режиме не знают. Nest дожидается асинхронной фабрики
 * до создания зависимых провайдеров, поэтому `DatabaseService` получает уже открытое соединение.
 * Пустую базу в памяти заполняет таблицами синхронизация структуры при запуске, как новый файл.
 */
export const databaseConnectionProvider: FactoryProvider<Promise<Database>> = {
    provide: DatabaseConnection,
    inject: [SettingsService],
    useFactory: async (settings: SettingsService) => {
        if (settings.database.kind === 'memory') {
            new Logger('Database').warn('База данных открыта в памяти: данные не сохранятся после остановки сервера');
            return connect(':memory:');
        }
        await mkdir(path.dirname(settings.database.path), { recursive: true });
        return connect(settings.database.path);
    },
};
