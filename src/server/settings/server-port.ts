import type { FactoryProvider } from '@nestjs/common';
import { LaunchArguments } from './launch-arguments.js';
import { SettingsService } from './settings.service.js';

/** Токен порта, который слушает сервер. */
export const ServerPort = Symbol('ServerPort');

/**
 * Выбирает порт сервера: параметр `--port`, если он передан, иначе порт из настроек.
 * Параметр позволяет запустить второй экземпляр, например проверочный рядом с режимом
 * разработки, не меняя файл настроек.
 */
export const serverPortProvider: FactoryProvider<number> = {
    provide: ServerPort,
    inject: [LaunchArguments, SettingsService],
    useFactory: (launch: LaunchArguments, settings: SettingsService) => launch.port ?? settings.port,
};
