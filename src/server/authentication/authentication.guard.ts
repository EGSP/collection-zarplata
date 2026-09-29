import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthenticationService } from './authentication.service.js';

/** Запрос после проверки access-cookie содержит пользователя для диспетчера действий. */
export interface AuthenticatedRequest extends FastifyRequest {
    userGuid: string;
}

/** Защищает perform до чтения тела диспетчером и передаёт подтверждённого пользователя. */
@Injectable()
export class AuthenticationGuard implements CanActivate {
    constructor(private readonly authentication: AuthenticationService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        request.userGuid = await this.authentication.authenticate(request.cookies['accessToken']);
        return true;
    }
}
