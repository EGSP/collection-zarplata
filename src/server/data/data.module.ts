import { Module } from '@nestjs/common';
import { DataController } from './data.controller.js';
import { DataService } from './data.service.js';

/** Подключает единый эндпоинт и диспетчер действий. */
@Module({ controllers: [DataController], providers: [DataService] })
export class DataModule {}
