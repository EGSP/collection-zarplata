import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { describeSchema } from './structure.js';
import { synchronizeSchema } from './synchronization.js';

/**
 * Синхронизирует структуру до начала приёма запросов. Хук приложения запускается после
 * открытия соединения провайдером базы и `onModuleInit` метаданных, поэтому оба источника уже готовы.
 */
@Injectable()
export class SchemaService implements OnApplicationBootstrap {
    constructor(private readonly database: DatabaseService, private readonly metadata: MetadataService) {}

    async onApplicationBootstrap(): Promise<void> {
        await synchronizeSchema(this.database.effect, describeSchema(this.metadata.objects));
    }
}
