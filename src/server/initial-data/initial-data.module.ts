import { Module } from '@nestjs/common';
import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { DataModule } from '../data/data.module.js';
import { InitialDataService } from './initial-data.service.js';

/**
 * Применение первичных данных при запуске. Модуль не подключает хуков жизненного цикла:
 * `InitialDataService.run` вызывает `main.ts` после открытия порта.
 */
@Module({
    imports: [AuthenticationModule, AuthorizationModule, DataModule],
    providers: [InitialDataService],
    exports: [InitialDataService],
})
export class InitialDataModule {}
