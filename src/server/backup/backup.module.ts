import { Module } from '@nestjs/common';
import { BackupService } from './backup.service.js';

/**
 * Резервное копирование файла базы. Модуль не импортирует модуль базы: копию пишет рабочий поток
 * со своим соединением, а путь к файлу берётся из глобальных настроек. API копий подключает
 * диспетчер единого эндпоинта, поэтому сервис экспортируется модулю данных.
 */
@Module({ providers: [BackupService], exports: [BackupService] })
export class BackupModule {}
