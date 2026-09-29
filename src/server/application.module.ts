import { Module } from '@nestjs/common';
import { ClientModule } from './client/client.module.js';
import { DataModule } from './data/data.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { MetadataModule } from './metadata/metadata.module.js';
import { SchemaModule } from './schema/schema.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { UiModule } from './ui/ui.module.js';

/** Корневой модуль связывает API данных и описания интерфейса с общими сервисами базы и метаданных. */
@Module({
    imports: [SettingsModule, DatabaseModule, MetadataModule, SchemaModule, DataModule, UiModule, HealthModule, ClientModule],
})
export class ApplicationModule {}
