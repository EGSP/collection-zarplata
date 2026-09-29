import type { FactoryProvider } from '@nestjs/common';

/**
 * Параметры командной строки, которые меняют запуск приложения. Их разбирает отдельный провайдер,
 * чтобы настройки и порт сервера получали готовые значения и не читали `process.argv` сами.
 */
export interface LaunchArguments {
    /** `memory` открывает пустую базу в памяти без файла настроек. */
    readonly database: 'file' | 'memory';
    /** Порт сервера вместо порта из настроек. */
    readonly port: number | undefined;
    /** PIN тестового пользователя, которого режим памяти создаёт при запуске. */
    readonly testPin: string | undefined;
}

/** Токен разобранных параметров запуска. */
export const LaunchArguments = Symbol('LaunchArguments');

/** PIN пользователя: от 4 до 12 цифр. */
export const pinPattern = /^[0-9]{4,12}$/;

/** Проверяет, что значение — допустимый номер порта TCP. */
export function portValue(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 1 && (value as number) <= 65535;
}

/**
 * Разбирает параметры запуска вида `--имя=значение`. Неизвестный параметр останавливает запуск:
 * опечатка в `--database=memory` иначе незаметно открыла бы рабочую базу.
 */
function readArguments(values: readonly string[]): LaunchArguments {
    let database: LaunchArguments['database'] = 'file';
    let port: number | undefined;
    let testPin: string | undefined;
    for (const argument of values) {
        const match = /^--([a-z-]+)=(.*)$/.exec(argument);
        const name = match?.[1];
        const value = match?.[2] ?? '';
        if (name === 'database' && (value === 'file' || value === 'memory')) {
            database = value;
        } else if (name === 'port' && /^[0-9]+$/.test(value) && portValue(Number(value))) {
            port = Number(value);
        } else if (name === 'test-pin' && pinPattern.test(value)) {
            testPin = value;
        } else if (name === 'database' || name === 'port' || name === 'test-pin') {
            throw new Error(`Неверное значение параметра запуска ${argument}: ожидается --database=file|memory, --port=1…65535 или --test-pin из 4–12 цифр`);
        } else {
            throw new Error(`Неизвестный параметр запуска ${argument}. Допустимы --database, --port и --test-pin`);
        }
    }
    if (testPin !== undefined && database !== 'memory') {
        // Тестовый PIN в рабочей базе создал бы постоянного пользователя с PIN из командной строки.
        throw new Error('Параметр --test-pin допустим только вместе с --database=memory');
    }
    return { database, port, testPin };
}

/** Разбирает параметры процесса один раз при сборке приложения; ошибка останавливает запуск. */
export const launchArgumentsProvider: FactoryProvider<LaunchArguments> = {
    provide: LaunchArguments,
    // В исполняемом файле Node ставит путь к нему на место пути к скрипту, поэтому параметры начинаются с третьего элемента и там.
    useFactory: () => readArguments(process.argv.slice(2)),
};
