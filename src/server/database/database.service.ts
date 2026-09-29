import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { Database } from '@tursodatabase/database';
import { Effect } from 'effect';
import { DatabaseConnection } from './database.connection.js';
import { DatabaseError } from './database.errors.js';
import { makeDatabase, type Database as EffectDatabase } from './database.effect.js';

/**
 * Nest владеет соединением Turso от запуска до остановки приложения.
 * Бизнес-логика получает через `effect` сервис с типизированными ошибками и транзакциями.
 * Какую базу открыть, решает провайдер соединения; сервис работает с любой одинаково.
 */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
    readonly effect: EffectDatabase;

    constructor(@Inject(DatabaseConnection) private readonly connection: Database) {
        this.effect = makeDatabase(connection);
    }

    async onModuleDestroy(): Promise<void> {
        await this.connection.close();
    }

    /** Проверяет, что база отвечает на запросы. */
    check(): Effect.Effect<void, DatabaseError> {
        return this.effect.get({ sql: 'SELECT 1 AS result', parameters: [] }).pipe(Effect.asVoid);
    }
}
