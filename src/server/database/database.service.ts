import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { connect, type Database } from '@tursodatabase/database';
import { Effect, Semaphore } from 'effect';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SettingsService } from '../settings/settings.service.js';
import { DatabaseError } from './database.errors.js';
import { makeDatabase, type Database as EffectDatabase } from './database.effect.js';

/**
 * Nest владеет соединением Turso от запуска до остановки приложения.
 * Бизнес-логика получает через `effect` сервис с типизированными ошибками и транзакциями.
 */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private database: Database | undefined;
    private effectDatabase: EffectDatabase | undefined;

    constructor(private readonly settings: SettingsService) {}

    async onModuleInit(): Promise<void> {
        await mkdir(path.dirname(this.settings.databasePath), { recursive: true });
        this.database = await connect(this.settings.databasePath);
        // Все транзакции и отдельные записи используют одно разрешение для общего соединения.
        this.effectDatabase = makeDatabase(this.database, Semaphore.makeUnsafe(1));
    }

    async onModuleDestroy(): Promise<void> {
        await this.database?.close();
    }

    /** Проверяет, что база отвечает на запросы. */
    check(): Effect.Effect<void, DatabaseError> {
        return this.effect.get({ sql: 'SELECT 1 AS result', parameters: [] }).pipe(Effect.asVoid);
    }

    /** Возвращает готовый Effect-сервис после открытия соединения модулем Nest. */
    get effect(): EffectDatabase {
        if (this.effectDatabase === undefined) throw new Error('Соединение с базой данных ещё не открыто');
        return this.effectDatabase;
    }
}
