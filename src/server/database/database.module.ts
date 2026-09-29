import { Global, Module } from '@nestjs/common';
import { databaseConnectionProvider } from './database.connection.js';
import { DatabaseService } from './database.service.js';

/** Соединение остаётся внутренним провайдером модуля: остальной код работает с базой только через `DatabaseService`. */
@Global()
@Module({
    providers: [databaseConnectionProvider, DatabaseService],
    exports: [DatabaseService],
})
export class DatabaseModule {}
