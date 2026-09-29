import { Injectable } from '@nestjs/common';
import { MetadataService } from '../metadata/metadata.service.js';
import type { MetadataResponse } from './descriptions.js';
import { buildObjectView } from './views.js';

/**
 * Описания форм и списков всех объектов конфигурации.
 *
 * Описания строятся один раз при первом обращении и дальше не меняются: метаданные собираются
 * при запуске, а конфигурация без перезапуска не меняется. Строить описания в `onModuleInit`
 * нельзя: порядок инициализации модулей не гарантирует, что метаданные к этому моменту готовы.
 */
@Injectable()
export class UiService {
    private response: MetadataResponse | undefined;

    constructor(private readonly metadata: MetadataService) {}

    /** Ответ `GET /api/metadata`. */
    get metadataResponse(): MetadataResponse {
        this.response ??= { objects: this.metadata.objects.map(buildObjectView) };
        return this.response;
    }
}
