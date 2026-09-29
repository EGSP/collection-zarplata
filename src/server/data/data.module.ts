import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { DataController } from './data.controller.js';
import { DataService } from './data.service.js';

/** Подключает единый эндпоинт и диспетчер действий. */
@Module({ imports: [AuthenticationModule], controllers: [DataController], providers: [DataService] })
export class DataModule {}
