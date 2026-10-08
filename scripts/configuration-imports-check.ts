/**
 * Проверка импортов клиентских файлов конфигурации: `npm run typecheck` запускает её перед проверкой типов.
 *
 * Страница и элемент формы собираются в клиент, но лежат вне `src/web`, рядом с серверными файлами
 * объектов. Компилятор не умеет запрещать импорты по каталогам, поэтому границу проверяет этот скрипт:
 *
 * - из клиента компонент импортирует только web SDK. Остальные модули `src/web` внутренние и могут
 *   меняться без оглядки на конфигурацию;
 * - из серверного кода и файлов объектов компонент импортирует только типы. Импорт значения
 *   включил бы в сборку клиента билдеры, Effect и обработчики действий;
 * - объявление страницы или элемента формы импортирует значение только из модуля своего билдера:
 *   файл объявления попадает и в сервер, и в клиент.
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

/** Точка входа web SDK: единственный модуль клиента, доступный компоненту конфигурации. */
const sdkModule = 'web/sdk';
/** Сгенерированные файлы клиента в каталоге конфигурации: их компонент импортирует как значения. */
const clientGeneratedModules = ['configuration/objects.generated', 'configuration/pages.generated', 'configuration/form-elements.generated'];

/**
 * Вид объявления: шаблон его файлов, название в сообщениях в родительном падеже и модуль билдера —
 * единственный серверный модуль, значение из которого объявление импортирует.
 */
interface DeclarationKind {
    readonly pattern: string;
    readonly title: string;
    readonly builderModule: string;
}

const declarationKinds: ReadonlyArray<DeclarationKind> = [
    { pattern: '**/*.page.ts', title: 'страницы', builderModule: 'server/ui/pages' },
    { pattern: '**/*.form-element.ts', title: 'элемента формы', builderModule: 'server/metadata/form-elements' },
];

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

/** Файл клиента в каталоге конфигурации: компонент страницы или элемента либо вспомогательный компонент рядом с ним. */
function isClientModule(module: string): boolean {
    return clientGeneratedModules.includes(module) || globSync(`${module}.tsx`, { cwd: sourceDirectory }).length > 0;
}

/** Нарушения границы импортов в одном файле. `declaration` задан у файла объявления, у компонента равен `null`. */
function check(file: string, declaration: DeclarationKind | null): Array<string> {
    const source = readFileSync(file, 'utf8');
    const problems: Array<string> = [];
    for (const match of source.matchAll(importPattern)) {
        const specifier = match[2] ?? match[3];
        // Импорт пакета границу не пересекает: серверные пакеты компонент получить может только через серверный модуль.
        if (specifier === undefined || !specifier.startsWith('.')) continue;
        const typeOnly = match[1] !== undefined;
        const module = moduleOf(file, specifier);
        const line = source.slice(0, match.index).split('\n').length;
        const place = `src/${path.relative(sourceDirectory, file).split(path.sep).join('/')}:${line}`;
        if (module.startsWith('web/')) {
            if (declaration !== null) problems.push(`${place}: объявление ${declaration.title} не импортирует клиент («${specifier}»): файл объявления собирается и сервером`);
            else if (module !== sdkModule) problems.push(`${place}: компонент конфигурации импортирует из клиента только web SDK (src/web/sdk), а «${specifier}» — внутренний модуль`);
        } else if (declaration !== null) {
            if (!typeOnly && module !== declaration.builderModule) {
                problems.push(`${place}: объявление ${declaration.title} импортирует значение только из src/${declaration.builderModule}, а «${specifier}» попал бы в сборку клиента`);
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
    ...declarationKinds.flatMap((kind) => findFiles(kind.pattern).flatMap((file) => check(file, kind))),
    ...findFiles('**/*.tsx').flatMap((file) => check(file, null)),
];

if (problems.length > 0) {
    console.error(`Клиентские файлы конфигурации нарушают границу импортов:\n${problems.join('\n')}`);
    process.exitCode = 1;
}
