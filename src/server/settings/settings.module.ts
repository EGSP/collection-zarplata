import { Global, Module } from '@nestjs/common';
import { TestEnvironment, testEnvironmentProvider } from './test-environment.js';
import { launchArgumentsProvider } from './launch-arguments.js';
import { ServerPort, serverPortProvider } from './server-port.js';
import { SettingsService } from './settings.service.js';

/** Настройки, среда и порт сервера доступны всему приложению; параметры запуска остаются внутри модуля. */
@Global()
@Module({
    providers: [launchArgumentsProvider, SettingsService, serverPortProvider, testEnvironmentProvider],
    exports: [SettingsService, ServerPort, TestEnvironment],
})
export class SettingsModule {}
