import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { BackupModule } from '../backup/backup.module.js';
import { DataController } from './data.controller.js';
import { DataService } from './data.service.js';

/**
 * Подключает единый эндпоинт и диспетчер действий; диспетчер проверяет права бизнес-гвардом.
 * Диспетчер экспортируется для модуля первичных данных: тот пишет записи с теми же политиками и журналом.
 * Модуль копий подключается ради действий `platform.backups` единого эндпоинта.
 */
@Module({ imports: [AuthenticationModule, AuthorizationModule, BackupModule], controllers: [DataController], providers: [DataService], exports: [DataService] })
export class DataModule {}
