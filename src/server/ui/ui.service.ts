import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { pageModules } from '../../configuration/configuration.generated.js';
import { applicationShell } from '../../configuration/shell.js';
import { RightsGuardPlatform } from '../authorization/rights-guard.platform.js';
import { pageOpenRight } from '../authorization/rights.js';
import { Database } from '../database/database.effect.js';
import { DatabaseService } from '../database/database.service.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { MetadataService } from '../metadata/metadata.service.js';
import type { MetadataResponse, ObjectView, PageView } from './descriptions.js';
import { loadPages } from './page-registry.js';
import { pageKind } from './pages.js';
import { restrictShell } from './shell.js';
import { buildObjectView, restrictObjectView } from './views.js';

/**
 * Описания форм и списков объектов конфигурации и перечень страниц для вошедшего пользователя.
 *
 * Полные описания строятся один раз при первом обращении и дальше не меняются: метаданные
 * собираются при запуске, а конфигурация без перезапуска не меняется. Строить описания
 * в `onModuleInit` нельзя: порядок инициализации модулей не гарантирует, что метаданные к этому
 * моменту готовы. Отбор по правам выполняется при каждом запросе: роли пользователя могут
 * измениться, а сам отбор — просмотр готовых описаний без обращения к метаданным.
 *
 * Страницы собираются в конструкторе: ошибка в объявлении страницы останавливает запуск
 * до приёма запросов. От метаданных объектов страницы не зависят, поэтому ждать их не нужно.
 */
@Injectable()
export class UiService {
    private views: ReadonlyArray<{ readonly object: ObjectDescription; readonly view: ObjectView }> | undefined;
    private readonly pages: ReadonlyArray<PageView>;

    constructor(
        private readonly metadata: MetadataService,
        private readonly database: DatabaseService,
        private readonly rightsGuard: RightsGuardPlatform,
    ) {
        // Сборка синхронна: проверка объявлений не обращается к внешним ресурсам.
        this.pages = Effect.runSync(loadPages(pageModules));
    }

    /**
     * Ответ `GET /api/metadata`: объекты, которые пользователь вправе читать, с действиями,
     * на которые у него есть права, страницы, которые он вправе открывать, и схема оболочки
     * из этих же объектов и страниц. Сбой чтения ролей отклоняет промис ошибкой базы.
     */
    async metadataResponse(userGuid: string): Promise<MetadataResponse> {
        this.views ??= this.metadata.objects.map((object) => ({ object, view: buildObjectView(object) }));
        const rights = await Effect.runPromise(this.rightsGuard.rightsOf(userGuid).pipe(Effect.provideService(Database, this.database.effect)));
        const objects = this.views.flatMap(({ object, view }) => restrictObjectView(object, view, rights.allows) ?? []);
        const pages = this.pages.filter((page) => rights.allows(pageOpenRight(page.name)));
        // Схема отбирается по уже отобранным описаниям: пункт без описания клиент не смог бы ни подписать, ни открыть.
        const available = new Set([...objects.map((object) => `${object.kind}.${object.name}`), ...pages.map((page) => `${pageKind}.${page.name}`)]);
        return { objects, pages, shell: restrictShell(applicationShell, (item) => available.has(`${item.kind}.${item.name}`)) };
    }
}
