import type { ValueProvider } from '@nestjs/common';
import { configurationVersion } from '../../configuration/version.js';
import { applicationVersions, platformVersion, type ApplicationReleaseVersions, type ApplicationVersions } from '../versions/versions.js';

/** Версии сборки и границы совместимости доступны модулям через один токен метаданных. */
export interface VersionInformation extends ApplicationReleaseVersions {
    readonly current: ApplicationVersions;
}

export const VersionInformation = Symbol('VersionInformation');

/** Значения заданы сборкой; отдельный сервис и вычисление при запуске для них не нужны. */
export const versionInformationProvider: ValueProvider<VersionInformation> = {
    provide: VersionInformation,
    useValue: { platform: platformVersion, configuration: configurationVersion, current: applicationVersions },
};
