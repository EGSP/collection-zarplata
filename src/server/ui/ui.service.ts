import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { applicationShell } from '../../configuration/shell.js';
import { RightsGuardPlatform } from '../authorization/rights-guard.platform.js';
import { Database } from '../database/database.effect.js';
import { DatabaseService } from '../database/database.service.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { MetadataService } from '../metadata/metadata.service.js';
import type { MetadataResponse, ObjectView } from './descriptions.js';
import { restrictShell } from './shell.js';
import { buildObjectView, restrictObjectView } from './views.js';

/**
 * Описания форм и списков объектов конфигурации для вошедшего пользователя.
 *
 * Полные описания строятся один раз при первом обращении и дальше не меняются: метаданные
 * собираются при запуске, а конфигурация без перезапуска не меняется. Строить описания
 * в `onModuleInit` нельзя: порядок инициализации модулей не гарантирует, что метаданные к этому
 * моменту готовы. Отбор по правам выполняется при каждом запросе: роли пользователя могут
 * измениться, а сам отбор — просмотр готовых описаний без обращения к метаданным.
 */
@Injectable()
export class UiService {
    private views: ReadonlyArray<{ readonly object: ObjectDescription; readonly view: ObjectView }> | undefined;

    constructor(
        private readonly metadata: MetadataService,
        private readonly database: DatabaseService,
        private readonly rightsGuard: RightsGuardPlatform,
    ) {}

    /**
     * Ответ `GET /api/metadata`: объекты, которые пользователь вправе читать, с действиями,
     * на которые у него есть права, и схема оболочки из этих же объектов. Сбой чтения ролей
     * отклоняет промис ошибкой базы.
     */
    async metadataResponse(userGuid: string): Promise<MetadataResponse> {
        this.views ??= this.metadata.objects.map((object) => ({ object, view: buildObjectView(object) }));
        const rights = await Effect.runPromise(this.rightsGuard.rightsOf(userGuid).pipe(Effect.provideService(Database, this.database.effect)));
        const objects = this.views.flatMap(({ object, view }) => restrictObjectView(object, view, rights.allows) ?? []);
        // Схема отбирается по уже отобранным описаниям: пункт без описания клиент не смог бы ни подписать, ни открыть.
        const readable = new Set(objects.map((object) => `${object.kind}.${object.name}`));
        return { objects, shell: restrictShell(applicationShell, (object) => readable.has(`${object.kind}.${object.name}`)) };
    }
}
