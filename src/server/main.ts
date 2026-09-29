import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApplicationModule } from './application.module.js';
import { SettingsService } from './settings/settings.service.js';

async function start(): Promise<void> {
    const application = await NestFactory.create<NestFastifyApplication>(ApplicationModule, new FastifyAdapter());
    application.setGlobalPrefix('api');
    application.enableShutdownHooks();

    const settings = application.get(SettingsService);
    await application.listen(settings.port, settings.host);
}

void start();
