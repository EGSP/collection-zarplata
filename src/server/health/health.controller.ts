import { Controller, Get } from '@nestjs/common';
import { Effect } from 'effect';
import { DatabaseService } from '../database/database.service.js';

/** Проверка состояния приложения: сервер запущен и база отвечает. */
@Controller('health')
export class HealthController {
    constructor(private readonly database: DatabaseService) {}

    @Get()
    health(): Promise<{ status: 'ok' }> {
        return Effect.runPromise(this.database.check().pipe(Effect.as({ status: 'ok' as const })));
    }
}
