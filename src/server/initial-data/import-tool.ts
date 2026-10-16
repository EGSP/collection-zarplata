/**
 * Запуск утилиты импорта из 1С (`tools/1c-xml-import`) дочерним процессом.
 *
 * Утилита загружает данные через HTTP API, поэтому шаг выполняется только после `listen`.
 * Выгрузки она ищет сама в каталоге `local-source` рядом со своим исполняемым файлом
 * (параметр `--local-source`): какие объекты в какой выгрузке, сервер не знает.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { isSea } from 'node:sea';
import { Effect } from 'effect';
import { InitialDataError } from './initial-data.errors.js';

/**
 * Каталог утилиты: при разработке — исходники в репозитории, рядом с которыми собирается
 * исполняемый файл, в собранном приложении — каталог самого приложения.
 */
const toolDirectory = isSea() ? path.dirname(process.execPath) : path.resolve(import.meta.dirname, '../../../tools/1c-xml-import');
const toolExecutable = path.join(toolDirectory, process.platform === 'win32' ? 'collection-xml-import.exe' : 'collection-xml-import');

/**
 * Импортирует справочник по сопоставлению `mappings/<mapping>.mapping.json` и возвращает
 * итоговую строку утилиты со счётчиками. PIN передаётся переменной окружения, а не аргументом:
 * аргументы процесса видны другим пользователям системы. Ненулевой код завершения
 * превращается в ошибку с текстом из потока ошибок утилиты. При прерывании эффекта процесс
 * останавливается, чтобы не продолжать загрузку в остановленный сервер.
 */
export function runImportTool(mapping: string, serverAddress: string, pin: string): Effect.Effect<string, InitialDataError> {
    return Effect.callback<string, InitialDataError>((resume) => {
        const child = spawn(toolExecutable, [
            '--local-source',
            '--mapping', path.join(toolDirectory, 'mappings', `${mapping}.mapping.json`),
            '--server', serverAddress,
        ], { env: { ...process.env, COLLECTION_IMPORT_PIN: pin }, windowsHide: true });
        let output = '';
        let errors = '';
        child.stdout.setEncoding('utf8').on('data', (chunk: string) => { output += chunk; });
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => { errors += chunk; });
        // Событие error приходит, если процесс не удалось запустить, например файл не собран.
        child.on('error', (cause) => resume(Effect.fail(new InitialDataError({
            message: `Не удалось запустить утилиту импорта ${toolExecutable}: ${cause.message}. Соберите её по руководству tools/1c-xml-import/README.md`,
        }))));
        child.on('close', (code) => resume(code === 0
            ? Effect.succeed(output.trim())
            : Effect.fail(new InitialDataError({ message: `Импорт «${mapping}» завершился с кодом ${String(code)}: ${errors.trim()}` }))));
        return Effect.sync(() => { child.kill(); });
    });
}
