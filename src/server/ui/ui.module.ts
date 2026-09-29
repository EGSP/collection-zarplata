import { Module } from '@nestjs/common';
import { MetadataController } from './metadata.controller.js';
import { UiService } from './ui.service.js';

/** Описания форм и списков (SDUI) и их выдача клиенту через `GET /api/metadata`. */
@Module({
    controllers: [MetadataController],
    providers: [UiService],
})
export class UiModule {}
