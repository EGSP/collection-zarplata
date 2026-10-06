import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DataController } from './data.controller.js';
import { DataService } from './data.service.js';

/** Подключает единый эндпоинт и диспетчер действий; диспетчер проверяет права бизнес-гвардом. */
@Module({ imports: [AuthenticationModule, AuthorizationModule], controllers: [DataController], providers: [DataService] })
export class DataModule {}
