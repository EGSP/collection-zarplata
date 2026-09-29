import { Module } from '@nestjs/common';
import { ClientModule } from './client/client.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { SettingsModule } from './settings/settings.module.js';

@Module({
    imports: [SettingsModule, DatabaseModule, HealthModule, ClientModule],
})
export class ApplicationModule {}
