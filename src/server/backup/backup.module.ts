import { Module } from '@nestjs/common';
import { BackupService } from './backup.service.js';

/**
 * Резервное копирование файла базы. Глобальный модуль базы хранит расписание; снимок пишет
 * рабочий поток со своим соединением. Путь берётся из глобальных настроек. API копий подключает
 * диспетчер единого эндпоинта, поэтому сервис экспортируется модулю данных.
 */
@Module({ providers: [BackupService], exports: [BackupService] })
export class BackupModule {}
