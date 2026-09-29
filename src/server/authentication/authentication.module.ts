import { Module } from '@nestjs/common';
import { AuthenticationController } from './authentication.controller.js';
import { AuthenticationGuard } from './authentication.guard.js';
import { AuthenticationService } from './authentication.service.js';

/** Подключает вход по PIN и экспортирует защиту маршрута данных. */
@Module({
    controllers: [AuthenticationController],
    providers: [AuthenticationService, AuthenticationGuard],
    exports: [AuthenticationService, AuthenticationGuard],
})
export class AuthenticationModule {}
