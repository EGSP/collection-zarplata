import { Global, Module } from '@nestjs/common';
import { launchArgumentsProvider } from './launch-arguments.js';
import { ServerPort, serverPortProvider } from './server-port.js';
import { SettingsService } from './settings.service.js';

/** Настройки и порт сервера доступны всему приложению; параметры запуска остаются внутри модуля. */
@Global()
@Module({
    providers: [launchArgumentsProvider, SettingsService, serverPortProvider],
    exports: [SettingsService, ServerPort],
})
export class SettingsModule {}
