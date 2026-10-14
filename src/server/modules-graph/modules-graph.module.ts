import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAsset, isSea } from 'node:sea';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { ModulesGraphController } from './modules-graph.controller.js';
import { ModulesGraphService } from './modules-graph.service.js';

/** Файл страницы в сборке клиента: Vite собирает её отдельной точкой входа рядом с index.html. */
const pageFile = 'modules-graph.html';

/**
 * Страница графа модулей Nest по адресу `/modules-graph` и данные для неё по `/api/modules-graph`.
 *
 * Страница собирается вместе с клиентом и использует его библиотеки, но открывается отдельно
 * от оболочки приложения, как документация. Собственный маршрут нужен по той же причине, что
 * у документации: общий маршрут клиента `/*` вернул бы на этот адрес страницу приложения.
 */
@Module({
    imports: [AuthenticationModule],
    controllers: [ModulesGraphController],
    providers: [ModulesGraphService],
})
export class ModulesGraphModule implements OnModuleInit {
    constructor(
        private readonly adapterHost: HttpAdapterHost,
        private readonly settings: SettingsService,
    ) {}

    onModuleInit(): void {
        const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();
        fastify.get('/modules-graph', async (_request, reply) => {
            const page = await this.readPage();
            if (page === undefined) {
                return reply.code(404).type('text/plain; charset=utf-8').send('Клиент не собран. Выполните команду npm run build:web.');
            }
            return reply.type('text/html; charset=utf-8').send(page);
        });
    }

    /** Страница из ресурсов исполняемого файла или из `dist/web`; `undefined`, если клиент не собран. */
    private async readPage(): Promise<Buffer | undefined> {
        if (isSea()) return Buffer.from(getAsset(`web/${pageFile}`));
        try {
            return await readFile(path.join(this.settings.webRootPath, pageFile));
        } catch {
            return undefined;
        }
    }
}
