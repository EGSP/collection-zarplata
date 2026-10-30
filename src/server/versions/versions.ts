/**
 * Версии платформы и конфигурации вида `x.y.z` и проверка их совместимости с базой.
 *
 * Версии заданы константами в коде, а не в `package.json`: исполняемому файлу этот файл недоступен.
 * Модуль не зависит от Nest и базы, поэтому его читает и скрипт упаковки.
 */
import { configurationVersion } from '../../configuration/version.js';

/** Версия части приложения и самая ранняя версия, чью базу эта сборка принимает. */
export interface ReleaseVersion {
    readonly version: string;
    /** Базу более ранней версии нужно сначала обновить промежуточным релизом: цепочка миграций от неё не проверялась. */
    readonly compatibleFrom: string;
}

/** Версии, которые сообщает запущенное приложение. */
export interface ApplicationVersions {
    readonly platform: string;
    readonly configuration: string;
}

/** Версия платформы: сервера, клиента и SDK. Увеличивается только в коммите релиза. */
export const platformVersion: ReleaseVersion = { version: '1.0.0', compatibleFrom: '1.0.0' };

/** Версии текущей сборки. */
export const applicationVersions: ApplicationVersions = { platform: platformVersion.version, configuration: configurationVersion.version };

/** Разбирает `x.y.z` на числа. Ошибка формата останавливает запуск: сравнить такую версию нельзя. */
export function parseVersion(version: string): readonly [number, number, number] {
    if (!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) {
        throw new Error(`Версия «${version}» не соответствует формату x.y.z`);
    }
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
    return [major, minor, patch];
}

/** Сравнивает версии по первым `parts` числам: отрицательный результат означает, что левая версия раньше. */
function compareVersions(left: string, right: string, parts: 2 | 3): number {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);
    for (let index = 0; index < parts; index += 1) {
        const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
        if (difference !== 0) return difference;
    }
    return 0;
}

/**
 * Проверяет, может ли сборка открыть базу, записанную версией `stored`, и возвращает текст отказа.
 * Различие только в `z` допустимо в обе стороны: такие изменения не затрагивают структуру базы,
 * поэтому исправление можно откатить на прежнюю сборку.
 */
export function databaseVersionProblem(title: string, stored: string, current: ReleaseVersion): string | undefined {
    if (compareVersions(stored, current.version, 2) > 0) {
        return `База записана более новой версией: ${title} ${stored}, в этой сборке ${current.version}. Обновите программу`;
    }
    if (compareVersions(stored, current.compatibleFrom, 3) < 0) {
        return `База записана слишком старой версией: ${title} ${stored}, эта сборка совместима начиная с ${current.compatibleFrom}. Сначала запустите промежуточный релиз`;
    }
    return undefined;
}
