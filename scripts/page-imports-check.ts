/**
 * Проверка импортов страниц конфигурации: `npm run typecheck` запускает её перед проверкой типов.
 *
 * Страница конфигурации собирается в клиент, но лежит вне `src/web`, рядом с серверными файлами
 * объектов. Компилятор не умеет запрещать импорты по каталогам, поэтому границу проверяет этот скрипт:
 *
 * - из клиента страница импортирует только web SDK. Остальные модули `src/web` внутренние и могут
 *   меняться без оглядки на страницы;
 * - из серверного кода и файлов объектов страница импортирует только типы. Импорт значения
 *   включил бы в сборку клиента билдеры, Effect и обработчики действий;
 * - объявление страницы импортирует значение только из модуля билдера страницы: файл объявления
 *   попадает и в сервер, и в клиент.
 *
 * Скрипт разбирает импорты регулярным выражением, а не компилятором: ему нужны только путь
 * и признак `import type`, а API компилятора в TypeScript 7 для этого подключать не стоит.
 *
 * Запускается Node без сборки, поэтому в скрипте допустим только стираемый синтаксис TypeScript.
 */
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const sourceDirectory = path.resolve(import.meta.dirname, '../src');
const configurationDirectory = path.join(sourceDirectory, 'configuration');

/** Точка входа web SDK: единственный модуль клиента, доступный странице. */
const sdkModule = 'web/sdk';
/** Модуль билдера страницы: единственный серверный модуль, значение из которого импортирует объявление. */
const pageBuilderModule = 'server/ui/pages';
/** Сгенерированные файлы клиента в каталоге конфигурации: их страница импортирует как значения. */
const clientGeneratedModules = ['configuration/objects.generated', 'configuration/pages.generated'];

/**
 * Импорт с путём: `import … from '…'`, `export … from '…'`, импорт ради побочного действия
 * и динамический `import('…')`. Группа `type` заполнена у импорта только типов.
 */
const importPattern = /\b(?:import|export)\s+(type\s+)?(?:[^'"();]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

/** Путь модуля относительно `src` без расширения и без `/index`, с `/`: `web/sdk`, `server/ui/pages`. */
function moduleOf(file: string, specifier: string): string {
    const resolved = path.relative(sourceDirectory, path.resolve(path.dirname(file), specifier)).split(path.sep).join('/');
    return resolved.replace(/\.(?:js|jsx|ts|tsx)$/, '').replace(/\/index$/, '');
}

/** Файл клиента в каталоге конфигурации: компонент страницы или вспомогательный компонент рядом с ним. */
function isClientModule(module: string): boolean {
    return clientGeneratedModules.includes(module) || globSync(`${module}.tsx`, { cwd: sourceDirectory }).length > 0;
}

/** Нарушения границы импортов в одном файле. `declaration` отличает объявление страницы от компонента. */
function check(file: string, declaration: boolean): Array<string> {
    const source = readFileSync(file, 'utf8');
    const problems: Array<string> = [];
    for (const match of source.matchAll(importPattern)) {
        const specifier = match[2] ?? match[3];
        // Импорт пакета границу не пересекает: серверные пакеты страница получить может только через серверный модуль.
        if (specifier === undefined || !specifier.startsWith('.')) continue;
        const typeOnly = match[1] !== undefined;
        const module = moduleOf(file, specifier);
        const line = source.slice(0, match.index).split('\n').length;
        const place = `src/${path.relative(sourceDirectory, file).split(path.sep).join('/')}:${line}`;
        if (module.startsWith('web/')) {
            if (declaration) problems.push(`${place}: объявление страницы не импортирует клиент («${specifier}»): файл объявления собирается и сервером`);
            else if (module !== sdkModule) problems.push(`${place}: страница импортирует из клиента только web SDK (src/web/sdk), а «${specifier}» — внутренний модуль`);
        } else if (declaration) {
            if (!typeOnly && module !== pageBuilderModule) {
                problems.push(`${place}: объявление страницы импортирует значение только из src/server/ui/pages, а «${specifier}» попал бы в сборку клиента`);
            }
        } else if (!typeOnly && !isClientModule(module)) {
            problems.push(`${place}: значение из «${specifier}» попало бы в сборку клиента вместе с серверным кодом; импортируйте только тип (import type)`);
        }
    }
    return problems;
}

/** Файлы по шаблону в каталоге конфигурации, абсолютными путями в стабильном порядке. */
function findFiles(pattern: string): Array<string> {
    return globSync(pattern, { cwd: configurationDirectory })
        .sort()
        .map((file) => path.join(configurationDirectory, file));
}

const problems = [
    ...findFiles('**/*.page.ts').flatMap((file) => check(file, true)),
    ...findFiles('**/*.tsx').flatMap((file) => check(file, false)),
];

if (problems.length > 0) {
    console.error(`Страницы конфигурации нарушают границу импортов:\n${problems.join('\n')}`);
    process.exitCode = 1;
}
