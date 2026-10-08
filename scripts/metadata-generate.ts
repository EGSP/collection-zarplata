/**
 * Генерация реестров конфигурации: `npm run metadata:generate`.
 *
 * Скрипт находит в `src/configuration` файлы объектов `*.{catalog,document,register,information-register}.ts`
 * и файлы страниц: объявления `*.page.ts` и компоненты `*.page-component.tsx`. По ним он пишет три файла:
 *
 * - `configuration.generated.ts` — реестр сервера: модули объектов, модули объявлений страниц
 *   и объект прав `Rights`, построенный из тех же модулей;
 * - `objects.generated.ts` — ссылки на объекты для клиента: по ним хуки и компоненты web SDK
 *   проверяют имена полей и действий при компиляции;
 * - `pages.generated.ts` — реестр страниц для клиента: объявление и компонент каждой страницы.
 *
 * Ссылки на объекты и реестр страниц лежат в разных файлах. Реестр импортирует страницы, а страницы
 * импортируют ссылки на объекты: в одном файле получился бы циклический импорт, и при загрузке
 * страницы ссылки могли бы быть ещё не определены.
 *
 * Объекты и страницы обнаруживаются на этапе сборки, а не при запуске: в собранном исполняемом
 * файле нет исходников `.ts`, по которым можно было бы искать файлы. Поэтому новый объект или
 * страница добавляется файлами, а реестры обновляются командой, а не правкой вручную.
 *
 * Скрипт не знает, что экспортирует файл, и импортирует модуль целиком. Проверку экспорта
 * (ровно один билдер нужного вида) выполняет сервер при запуске: там доступны сами билдеры,
 * а здесь пришлось бы разбирать исходник. Парность файлов страницы скрипт проверяет сам, потому
 * что видит оба файла: объявление без компонента и компонент без объявления останавливают генерацию.
 *
 * С флагом `--watch` скрипт после первой генерации следит за каталогом конфигурации и обновляет
 * реестры, когда файлы объектов и страниц появляются, удаляются или переименовываются.
 *
 * Запускается Node без сборки: Node 24 удаляет аннотации типов сам, поэтому в скрипте допустим
 * только стираемый синтаксис TypeScript.
 */
import { globSync, readFileSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';

const configurationDirectory = path.resolve(import.meta.dirname, '../src/configuration');
const objectFilePattern = '**/*.{catalog,document,register,information-register}.ts';
const pageDeclarationSuffix = '.page.ts';
const pageComponentSuffix = '.page-component.tsx';

/** Страница конфигурации: пути файла объявления и файла компонента относительно каталога конфигурации. */
interface PageFiles {
    readonly declaration: string;
    readonly component: string;
}

/** Нарушение соглашения о файлах конфигурации. Сообщение называет файл и объясняет, чего не хватает. */
class ConfigurationFilesError extends Error {}

/** Пути файлов по шаблону относительно каталога конфигурации, с `/` и в стабильном порядке. */
function findFiles(pattern: string): Array<string> {
    return globSync(pattern, { cwd: configurationDirectory })
        .map((file) => file.split(path.sep).join('/'))
        .sort();
}

/**
 * Страницы конфигурации в порядке путей объявлений. Файлы одной страницы различаются только
 * суффиксом. Завершается `ConfigurationFilesError`, если у объявления нет компонента или
 * у компонента нет объявления: без пары страница либо не открылась бы, либо не попала бы в меню.
 */
function findPages(): Array<PageFiles> {
    const declarations = findFiles(`**/*${pageDeclarationSuffix}`);
    const components = new Set(findFiles(`**/*${pageComponentSuffix}`));
    const problems: Array<string> = [];
    const pages = declarations.map((declaration) => {
        const component = declaration.slice(0, -pageDeclarationSuffix.length) + pageComponentSuffix;
        if (!components.delete(component)) problems.push(`у объявления страницы ${declaration} нет компонента: ожидается файл ${component}`);
        return { declaration, component };
    });
    for (const component of components) {
        const declaration = component.slice(0, -pageComponentSuffix.length) + pageDeclarationSuffix;
        problems.push(`у компонента страницы ${component} нет объявления: ожидается файл ${declaration}`);
    }
    if (problems.length > 0) throw new ConfigurationFilesError(problems.join('\n'));
    return pages;
}

const header = [
    '// Файл создан командой `npm run metadata:generate`. Не редактируйте его вручную:',
    '// изменения пропадут при следующей генерации. Чтобы добавить объект конфигурации,',
    '// создайте файл *.catalog.ts, *.document.ts, *.register.ts или *.information-register.ts в src/configuration.',
    '// Чтобы добавить страницу, создайте пару файлов *.page.ts и *.page-component.tsx.',
];

/** Путь импорта файла для сервера: `tsc` с NodeNext требует расширение `.js`. */
function serverImport(file: string): string {
    return `./${file.replace(/\.ts$/, '.js')}`;
}

/** Путь импорта файла для клиента: Vite и `tsc` с разрешением Bundler находят файл без расширения. */
function clientImport(file: string): string {
    return `./${file.replace(/\.tsx?$/, '')}`;
}

/** Текст реестра сервера. Порядок файлов отсортирован, чтобы повторная генерация давала тот же текст. */
function renderServerRegistry(objects: ReadonlyArray<string>, pages: ReadonlyArray<PageFiles>): string {
    return [
        ...header,
        "import { defineRights } from '../server/authorization/rights.js';",
        "import type { ConfigurationModule } from '../server/metadata/registry.js';",
        ...objects.map((file, index) => `import * as module${index} from '${serverImport(file)}';`),
        ...pages.map((page, index) => `import * as page${index} from '${serverImport(page.declaration)}';`),
        '',
        '/** Модули объектов конфигурации в порядке путей файлов. */',
        'export const configurationModules: ReadonlyArray<ConfigurationModule> = [',
        ...objects.map((file, index) => `    { file: '${file}', exports: module${index} },`),
        '];',
        '',
        '/** Модули объявлений страниц конфигурации в порядке путей файлов. */',
        'export const pageModules: ReadonlyArray<ConfigurationModule> = [',
        ...pages.map((page, index) => `    { file: '${page.declaration}', exports: page${index} },`),
        '];',
        '',
        '/** Права объектов, страниц и платформы. Роли указывают права этими переменными, а не строками. */',
        `export const Rights = defineRights([${objects.map((_file, index) => `module${index}`).join(', ')}], [${pages.map((_page, index) => `page${index}`).join(', ')}]);`,
        '',
    ].join('\n');
}

/**
 * Текст файла ссылок на объекты для клиента. Файлы объектов импортируются только как типы:
 * файл объекта тянет за собой билдеры, Effect, обработчики действий и политики с чтением базы,
 * и импорт значения включил бы серверный код в сборку клиента.
 */
function renderObjectReferences(objects: ReadonlyArray<string>): string {
    return [
        ...header,
        "import { objectReferences } from '../web/sdk/object-reference';",
        ...objects.map((file, index) => `import type * as module${index} from '${clientImport(file)}';`),
        '',
        '/**',
        ' * Ссылки на объекты конфигурации для страниц: `Objects.document.sample`. По ссылке хуки и компоненты',
        ' * web SDK проверяют имена полей и действий и выводят тип записи.',
        ' */',
        `export const Objects = objectReferences<[${objects.map((_file, index) => `typeof module${index}`).join(', ')}]>();`,
        '',
    ].join('\n');
}

/** Текст реестра страниц для клиента: объявление и компонент каждой страницы. */
function renderPageRegistry(pages: ReadonlyArray<PageFiles>): string {
    return [
        ...header,
        "import type { ConfigurationPageModule } from '../web/application/configuration-pages';",
        ...pages.flatMap((page, index) => [
            `import * as declaration${index} from '${clientImport(page.declaration)}';`,
            `import Component${index} from '${clientImport(page.component)}';`,
        ]),
        '',
        '/** Страницы конфигурации в порядке путей файлов. Компонент — экспорт по умолчанию файла компонента. */',
        'export const configurationPages: ReadonlyArray<ConfigurationPageModule> = [',
        ...pages.map((page, index) => `    { file: '${page.declaration}', declaration: declaration${index}, component: Component${index} },`),
        '];',
        '',
    ].join('\n');
}

/**
 * Пишет файл, только если текст изменился. Лишняя запись заставила бы `tsc --watch`
 * пересобрать сервер, `node --watch` — перезапустить его, а Vite — обновить страницу без причины.
 * Возвращает `true`, если файл записан.
 */
function writeIfChanged(name: string, content: string): boolean {
    const file = path.join(configurationDirectory, name);
    let current: string | null = null;
    try {
        current = readFileSync(file, 'utf8');
    } catch {
        // Файла ещё нет: первая генерация в новом клоне или worktree.
    }
    if (current === content) return false;
    writeFileSync(file, content);
    return true;
}

/** Обновляет реестры. Завершается `ConfigurationFilesError`, если нарушена парность файлов страниц; тогда ни один файл не меняется. */
function generate(): void {
    const objects = findFiles(objectFilePattern);
    const pages = findPages();
    const written = [
        writeIfChanged('configuration.generated.ts', renderServerRegistry(objects, pages)),
        writeIfChanged('objects.generated.ts', renderObjectReferences(objects)),
        writeIfChanged('pages.generated.ts', renderPageRegistry(pages)),
    ];
    if (written.includes(true)) console.log(`Реестры конфигурации обновлены: файлов объектов ${objects.length}, страниц ${pages.length}`);
}

/** Сообщает о нарушении соглашения о файлах; остальные ошибки считаются сбоем скрипта и идут дальше. */
function reportFilesError(error: unknown): void {
    if (!(error instanceof ConfigurationFilesError)) throw error;
    console.error(`Реестры конфигурации не обновлены:\n${error.message}`);
}

if (process.argv.includes('--watch')) {
    // В режиме слежения нарушение не останавливает скрипт: файлы страницы создаются по одному,
    // и между созданием первого и второго пара неполна. Реестры остаются прежними до исправления.
    const regenerate = () => {
        try {
            generate();
        } catch (error) {
            reportFilesError(error);
        }
    };
    regenerate();
    let timer: NodeJS.Timeout | undefined;
    // Имена файлов из событий не фильтруются: при удалении каталога событие приходит с именем
    // каталога, а не файлов объектов. Поиск файлов дешёвый, а неизменный реестр не перезаписывается.
    // Редактор при сохранении даёт несколько событий подряд; достаточно одной генерации после них.
    watch(configurationDirectory, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(regenerate, 100);
    });
    console.log('Слежу за файлами объектов и страниц конфигурации');
} else {
    try {
        generate();
    } catch (error) {
        reportFilesError(error);
        process.exitCode = 1;
    }
}
