import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthenticationService } from './authentication.service.js';

/** Запрос после проверки access-cookie содержит UUID и имя вошедшего пользователя. */
export interface AuthenticatedRequest extends FastifyRequest {
    userGuid: string;
    userName: string;
}

/** Защищает perform до чтения тела диспетчером и передаёт подтверждённого пользователя. */
@Injectable()
export class AuthenticationGuard implements CanActivate {
    constructor(private readonly authentication: AuthenticationService) {}

    /** Передаёт обработчикам пользователя, подтверждённого по токену. */
    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const user = await this.authentication.authenticate(request.cookies['accessToken']);
        request.userGuid = user.guid;
        request.userName = user.name;
        return true;
    }
}
