import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { connect, type Database } from '@tursodatabase/database';
import { Effect, Semaphore } from 'effect';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SettingsService } from '../settings/settings.service.js';
import { DatabaseError } from './database.errors.js';
import { makeDatabase, type Database as EffectDatabase } from './database.effect.js';

/** Единственное соединение процесса с файлом БД Turso. */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private database: Database | undefined;
    private effectDatabase: EffectDatabase | undefined;

    constructor(private readonly settings: SettingsService) {}

    async onModuleInit(): Promise<void> {
        await mkdir(path.dirname(this.settings.databasePath), { recursive: true });
        this.database = await connect(this.settings.databasePath);
        this.effectDatabase = makeDatabase(this.database, Semaphore.makeUnsafe(1));
    }

    async onModuleDestroy(): Promise<void> {
        await this.database?.close();
    }

    /** Проверяет, что база отвечает на запросы. */
    check(): Effect.Effect<void, DatabaseError> {
        return this.effect.get({ sql: 'SELECT 1 AS result', parameters: [] }).pipe(Effect.asVoid);
    }

    /** Effect-сервис для бизнес-логики. */
    get effect(): EffectDatabase {
        if (this.effectDatabase === undefined) throw new Error('Соединение с базой данных ещё не открыто');
        return this.effectDatabase;
    }
}
