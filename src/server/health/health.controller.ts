import { Controller, Get } from '@nestjs/common';
import { Effect } from 'effect';
import { DatabaseService } from '../database/database.service.js';
import { applicationVersions, type ApplicationVersions } from '../versions/versions.js';

/** Ответ `GET /api/health`. */
export interface HealthResponse {
    readonly status: 'ok';
    readonly versions: ApplicationVersions;
}

/**
 * Проверка состояния приложения: сервер запущен и база отвечает. Маршрут открыт без входа,
 * поэтому версии видны и на экране входа, и при проверке поставки запросом.
 */
@Controller('health')
export class HealthController {
    constructor(private readonly database: DatabaseService) {}

    @Get()
    health(): Promise<HealthResponse> {
        return Effect.runPromise(this.database.check().pipe(Effect.as({ status: 'ok' as const, versions: applicationVersions })));
    }
}
