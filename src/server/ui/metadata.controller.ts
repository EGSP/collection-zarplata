import { Controller, Get } from '@nestjs/common';
import type { MetadataResponse } from './descriptions.js';
import { UiService } from './ui.service.js';

/**
 * Описания объектов для клиента: по ним он строит формы и списки. Заготовка: доступ по токену
 * и отбор объектов и действий по правам добавят #9 и #12.
 */
@Controller('metadata')
export class MetadataController {
    constructor(private readonly ui: UiService) {}

    @Get()
    metadata(): MetadataResponse {
        return this.ui.metadataResponse;
    }
}
