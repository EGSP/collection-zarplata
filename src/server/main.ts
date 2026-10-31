import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import fastifyCookie from '@fastify/cookie';
import { Logger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApplicationModule } from './application.module.js';
import { InitialDataService } from './initial-data/initial-data.service.js';
import { ServerPort } from './settings/server-port.js';
import { SettingsService } from './settings/settings.service.js';
import { applicationVersions } from './versions/versions.js';

async function start(): Promise<void> {
    // Версии выводятся первыми: они нужны и тогда, когда запуск остановится на проверке базы.
    new Logger('Versions').log(`Платформа ${applicationVersions.platform}, конфигурация ${applicationVersions.configuration}`);
    const application = await NestFactory.create<NestFastifyApplication>(ApplicationModule, new FastifyAdapter());
    await application.register(fastifyCookie);
    application.setGlobalPrefix('api');
    application.enableShutdownHooks();

    const settings = application.get(SettingsService);
    await application.listen(application.get<number>(ServerPort), settings.host);

    // Первичные данные применяются после listen: утилита импорта загружает их через HTTP API.
    // Ошибка останавливает сервер, чтобы он не продолжал работать с неполными данными.
    try {
        await application.get(InitialDataService).run();
    } catch (error) {
        new Logger('InitialData').error(error instanceof Error ? error.message : String(error));
        await application.close();
        process.exitCode = 1;
    }
}

void start();
