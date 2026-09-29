import { Global, Module } from '@nestjs/common';
import { MetadataService } from './metadata.service.js';

/** Глобальный модуль: описания объектов нужны почти всем модулям платформы. */
@Global()
@Module({
    providers: [MetadataService],
    exports: [MetadataService],
})
export class MetadataModule {}
