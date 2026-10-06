import { Module } from '@nestjs/common';
import { RightsGuardNest } from './rights-guard.nest.js';
import { RightsGuardPlatform } from './rights-guard.platform.js';

/** Проверка прав: бизнес-гвард для диспетчера и описаний, Nest-гвард для отдельных маршрутов. */
@Module({
    providers: [RightsGuardPlatform, RightsGuardNest],
    exports: [RightsGuardPlatform, RightsGuardNest],
})
export class AuthorizationModule {}
