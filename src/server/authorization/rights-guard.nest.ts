import { applyDecorators, CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Effect } from 'effect';
import { AuthenticationGuard, type AuthenticatedRequest } from '../authentication/authentication.guard.js';
import { Database } from '../database/database.effect.js';
import { DatabaseService } from '../database/database.service.js';
import { RightsDeniedError } from './authorization.errors.js';
import type { Right } from './rights.js';
import { RightsGuardPlatform } from './rights-guard.platform.js';

/** Ключ метаданных Nest, под которым декоратор хранит права маршрута. */
const requiredRightsKey = 'authorization:requiredRights';

/**
 * Требует у вошедшего пользователя все перечисленные права для маршрута или контроллера вне
 * единого эндпоинта: `@RequireRights(Rights.catalog.employees.read)`. Декоратор подключает
 * и проверку входа, и проверку прав в нужном порядке: права проверяются у пользователя, которого
 * определил вход. Модуль контроллера должен импортировать `AuthenticationModule`
 * и `AuthorizationModule`. Декоратор метода заменяет права, указанные на контроллере.
 */
export function RequireRights(...rights: ReadonlyArray<Right>): MethodDecorator & ClassDecorator {
    return applyDecorators(SetMetadata(requiredRightsKey, rights), UseGuards(AuthenticationGuard, RightsGuardNest));
}

/**
 * Nest-обёртка бизнес-гварда для маршрутов вне единого эндпоинта. Сама права не сравнивает:
 * читает права маршрута из декоратора `@RequireRights` и передаёт их `RightsGuardPlatform`.
 * Отказ превращается в HTTP 403.
 */
@Injectable()
export class RightsGuardNest implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly rightsGuard: RightsGuardPlatform,
        private readonly database: DatabaseService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const rights = this.reflector.getAllAndOverride<ReadonlyArray<Right> | undefined>(requiredRightsKey, [context.getHandler(), context.getClass()]);
        // Гвард без прав пропускал бы любого вошедшего пользователя. Это ошибка разработчика, а не отказ пользователю.
        if (rights === undefined || rights.length === 0) throw new Error('RightsGuardNest подключён без прав: используйте декоратор @RequireRights(...)');
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const check = this.rightsGuard.require(request.userGuid ?? null, ...rights).pipe(
            Effect.catchTag('RightsDeniedError', (error: RightsDeniedError) => Effect.succeed(error)),
            Effect.provideService(Database, this.database.effect),
        );
        const denied = await Effect.runPromise(check);
        if (denied !== undefined) throw new ForbiddenException(denied.message);
        return true;
    }
}
