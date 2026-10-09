import { Module, type OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { FastifyInstance } from 'fastify';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAsset, getAssetKeys, isSea } from 'node:sea';
import { SettingsService } from '../settings/settings.service.js';

/** Типы содержимого файлов, из которых состоит собранный сайт VitePress. */
const contentTypes: Readonly<Record<string, string>> = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    ico: 'image/x-icon',
    woff2: 'font/woff2',
};

/**
 * Раздача сайта документации по адресу `/docs`. Сайт собран заранее из каталога `docs`
 * и лежит в `dist/docs`, а в исполняемом файле — в его ресурсах под именами `docs/…`.
 *
 * Модуль отвечает на все адреса внутри `/docs` сам. Клиент приложения возвращает свою страницу
 * на любой неизвестный адрес, чтобы работали адреса вкладок; без собственного маршрута вместо
 * отсутствующей страницы документации открылся бы клиент. Маршрут `/docs/*` точнее маршрута
 * клиента `/*`, поэтому Fastify выбирает его независимо от порядка подключения модулей.
 *
 * Сайт отдаётся без входа в приложение: cookie доступа браузер отправляет только на `/api`,
 * и проверить её здесь нельзя. Поэтому в `docs` не кладутся секреты и данные магазина.
 */
@Module({})
export class DocumentationModule implements OnModuleInit {
    private readonly embeddedFiles = isSea() ? new Set(getAssetKeys()) : new Set<string>();

    constructor(
        private readonly adapterHost: HttpAdapterHost,
        private readonly settings: SettingsService,
    ) {}

    onModuleInit(): void {
        const fastify = this.adapterHost.httpAdapter.getInstance<FastifyInstance>();

        // Ссылки сайта отсчитываются от /docs/, поэтому адрес без косой черты перенаправляется.
        fastify.get('/docs', (_request, reply) => reply.redirect('/docs/'));

        fastify.get<{ Params: { '*': string } }>('/docs/*', async (request, reply) => {
            const requestedPath = request.params['*'];
            const filePath = requestedPath === '' || requestedPath.endsWith('/') ? `${requestedPath}index.html` : requestedPath;
            // Страницу можно открыть и без расширения: так адрес короче, а ссылки сайта ведут на .html.
            for (const candidate of [filePath, `${filePath}.html`]) {
                const content = await this.read(candidate);
                if (content === undefined) continue;
                // Имена файлов в assets содержат хеш содержимого, поэтому браузер может хранить их бессрочно.
                if (candidate.startsWith('assets/')) void reply.header('cache-control', 'public, max-age=31536000, immutable');
                return reply.type(contentTypes[path.extname(candidate).slice(1)] ?? 'application/octet-stream').send(content);
            }
            const notFoundPage = await this.read('404.html');
            if (notFoundPage !== undefined) return reply.code(404).type('text/html; charset=utf-8').send(notFoundPage);
            return reply.code(404).type('text/plain; charset=utf-8')
                .send('Сайт документации не собран. Выполните команду npm run build:docs.');
        });
    }

    /** Содержимое файла сайта по пути относительно его корня или `undefined`, если файла нет. */
    private async read(relativePath: string): Promise<Buffer | undefined> {
        if (isSea()) {
            const assetPath = `docs/${relativePath}`;
            return this.embeddedFiles.has(assetPath) ? Buffer.from(getAsset(assetPath)) : undefined;
        }
        const root = this.settings.documentationRootPath;
        const absolutePath = path.resolve(root, relativePath);
        // Путь с «..» вывел бы за пределы сайта и позволил бы прочитать любой файл на диске.
        if (!absolutePath.startsWith(root + path.sep)) return undefined;
        try {
            return await readFile(absolutePath);
        } catch {
            return undefined;
        }
    }
}
