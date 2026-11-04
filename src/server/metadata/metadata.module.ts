import { AuthenticationModule } from '../authentication/authentication.module.js';
import { AuthorizationModule } from '../authorization/authorization.module.js';
import { Global, Module } from '@nestjs/common';
import { MetadataService } from './metadata.service.js';
import { VersionInformation, versionInformationProvider } from './version-information.js';

/** Глобальный модуль предоставляет описания объектов и версии сборки модулям платформы. */
@Global()
@Module({
    imports: [AuthenticationModule, AuthorizationModule],
    providers: [MetadataService, versionInformationProvider],
    exports: [MetadataService, VersionInformation],
})
export class MetadataModule {}
