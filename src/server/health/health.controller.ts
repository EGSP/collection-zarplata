import { Controller, Get, Inject } from '@nestjs/common';
import { Effect } from 'effect';
import { DatabaseService } from '../database/database.service.js';
import type { ApplicationVersions } from '../versions/versions.js';
import { TestEnvironment } from '../settings/test-environment.js';
import { VersionInformation } from '../metadata/version-information.js';

/** Ответ `GET /api/health`. */
export interface HealthResponse {
    readonly status: 'ok';
    /** Итоговый признак среды из настроек запуска, в том числе до входа. */
    readonly testEnvironment: boolean;
    readonly versions: ApplicationVersions;
}

/**
 * Проверка состояния приложения: сервер запущен и база отвечает. Маршрут открыт без входа,
 * поэтому среда и версии видны и на экране входа, и при проверке поставки запросом.
 */
@Controller('health')
export class HealthController {
    constructor(
        private readonly database: DatabaseService,
        @Inject(VersionInformation) private readonly versions: VersionInformation,
        @Inject(TestEnvironment) private readonly testEnvironment: boolean,
    ) {}

    @Get()
    health(): Promise<HealthResponse> {
        return Effect.runPromise(this.database.check().pipe(Effect.as({ status: 'ok' as const, versions: this.versions.current, testEnvironment: this.testEnvironment })));
    }
}
