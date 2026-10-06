import { Module } from '@nestjs/common';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { AuthenticationController } from './authentication.controller.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { AuthenticationService } from './authentication.service.js';

/** Подключает вход по PIN и экспортирует защиту маршрута данных. Роли первым пользователям назначает через модуль прав. */
@Module({
    imports: [AuthorizationModule],
    controllers: [AuthenticationController],
    providers: [AuthenticationService, AuthenticationGuard],
    exports: [AuthenticationService, AuthenticationGuard],
})
export class AuthenticationModule {}
