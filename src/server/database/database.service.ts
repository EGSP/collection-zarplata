import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { connect, type Database } from '@tursodatabase/database';
import { Effect } from 'effect';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { SettingsService } from '../settings/settings.service.js';
import { DatabaseError } from './database.errors.js';

/** Единственное соединение процесса с файлом БД Turso. */
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
    private database: Database | undefined;

    constructor(private readonly settings: SettingsService) {}

    async onModuleInit(): Promise<void> {
        await mkdir(path.dirname(this.settings.databasePath), { recursive: true });
        this.database = await connect(this.settings.databasePath);
    }

    async onModuleDestroy(): Promise<void> {
        await this.database?.close();
    }

    /** Проверяет, что база отвечает на запросы. */
    check(): Effect.Effect<void, DatabaseError> {
        return Effect.tryPromise({
            try: () => this.connection().get('SELECT 1 AS result'),
            catch: (cause) => new DatabaseError({ operation: 'check', cause }),
        }).pipe(Effect.asVoid);
    }

    private connection(): Database {
        if (this.database === undefined) throw new Error('Соединение с базой данных ещё не открыто');
        return this.database;
    }
}
