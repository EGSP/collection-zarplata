/**
 * Версия конфигурации: объектов, ролей и правил магазина. Увеличивается независимо от версии
 * платформы и только в коммите релиза, иначе параллельные ветки конфликтовали бы из-за номера.
 * Правила увеличения описаны в разделе «Версии» документации.
 */
import type { ReleaseVersion } from '../server/versions/versions.js';

export const configurationVersion: ReleaseVersion = { version: '1.0.0', compatibleFrom: '1.0.0' };
