import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Раздача собранного клиента. Файлы из dist/web отдаются как есть,
 * на остальные GET-запросы вне /api возвращается index.html: маршрутизацией занимается клиент.
 */
@Module({})
export class ClientModule implements OnModuleInit {
    constructor(
        private readonly adapterHost: HttpAdapterHost,
        private readonly settings: SettingsService,
    ) {}

    async onModuleInit(): Promise<void> {
        const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
        await fastify.register(fastifyStatic, { root: this.settings.webRootPath, wildcard: false });

        fastify.get('/*', (request, reply) => {
            if (request.url === '/api' || request.url.startsWith('/api/')) {
                return reply.code(404).send({ message: 'Not Found', statusCode: 404 });
            }
            return reply.sendFile('index.html');
        });
    }
}
