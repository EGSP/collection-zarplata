import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthenticationGuard, type AuthenticatedRequest } from '../authentication/authentication.guard.js';
import type { MetadataResponse } from './descriptions.js';
import { UiService } from './ui.service.js';

/**
 * Описания объектов для клиента: по ним он строит формы и списки. Маршрут требует входа
 * и не требует отдельного права: состав ответа зависит от прав пользователя, и пользователь
 * без прав получает пустой список объектов.
 */
@Controller('metadata')
@UseGuards(AuthenticationGuard)
export class MetadataController {
    constructor(private readonly ui: UiService) {}

    @Get()
    metadata(@Req() request: AuthenticatedRequest): Promise<MetadataResponse> {
        return this.ui.metadataResponse(request.userGuid);
    }
}
