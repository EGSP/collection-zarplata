import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { MetadataController } from './metadata.controller.js';
import { UiService } from './ui.service.js';

/** Описания форм и списков (SDUI) и их выдача клиенту через `GET /api/metadata` с учётом прав пользователя. */
@Module({
    imports: [AuthenticationModule, AuthorizationModule],
    controllers: [MetadataController],
    providers: [UiService],
})
export class UiModule {}
