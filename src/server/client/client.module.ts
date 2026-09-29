import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { getAsset, getAssetKeys, isSea } from 'node:sea';
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
        if (!isSea()) {
            await fastify.register(fastifyStatic, { root: this.settings.webRootPath, wildcard: false });
        }

        const embeddedFiles = isSea() ? new Set(getAssetKeys()) : new Set<string>();

        fastify.get('/*', (request, reply) => {
            if (request.url === '/api' || request.url.startsWith('/api/')) {
                return reply.code(404).send({ message: 'Not Found', statusCode: 404 });
            }
            if (isSea()) {
                const requestedPath = request.url.split('?', 1)[0]?.replace(/^\//, '') ?? '';
                const assetPath = `web/${requestedPath}`;
                if (embeddedFiles.has(assetPath)) {
                    const extension = requestedPath.split('.').at(-1);
                    const mimeType = extension === 'js' ? 'text/javascript'
                        : extension === 'css' ? 'text/css'
                        : extension === 'svg' ? 'image/svg+xml'
                        : extension === 'png' ? 'image/png'
                        : extension === 'ico' ? 'image/x-icon'
                        : 'application/octet-stream';
                    return reply.type(mimeType).send(Buffer.from(getAsset(assetPath)));
                }
                return reply.type('text/html; charset=utf-8').send(Buffer.from(getAsset('web/index.html')));
            }
            return reply.sendFile('index.html');
        });
    }
}
