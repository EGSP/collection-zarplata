/**
 * Генерация реестров конфигурации: `npm run metadata:generate`.
 *
 * Скрипт находит в `src/configuration` файлы объектов `*.{catalog,document,register,information-register}.ts`
 * и файлы частей с компонентами React. Такая часть состоит из объявления и компонента: у страницы
 * это `*.page.ts` и `*.page-component.tsx`, у элемента формы — `*.form-element.ts`
 * и `*.form-element-component.tsx`. По ним скрипт пишет четыре файла:
 *
 * - `configuration.generated.ts` — реестр сервера: модули объектов, модули объявлений страниц
 *   и элементов формы и объект прав `Rights`, построенный из модулей объектов и страниц;
 * - `objects.generated.ts` — ссылки на объекты для клиента: по ним хуки и компоненты web SDK
 *   проверяют имена полей и действий при компиляции;
 * - `pages.generated.ts` — реестр страниц для клиента: объявление и компонент каждой страницы;
 * - `form-elements.generated.ts` — реестр элементов формы для клиента в том же виде.
 *
 * Ссылки на объекты и реестры компонентов лежат в разных файлах. Реестр импортирует компоненты,
 * а компоненты импортируют ссылки на объекты: в одном файле получился бы циклический импорт,
 * и при загрузке компонента ссылки могли бы быть ещё не определены.
 *
 * Объекты, страницы и элементы обнаруживаются на этапе сборки, а не при запуске: в собранном
 * исполняемом файле нет исходников `.ts`, по которым можно было бы искать файлы. Поэтому они
 * добавляются файлами, а реестры обновляются командой, а не правкой вручную.
 *
 * Скрипт не знает, что экспортирует файл, и импортирует модуль целиком. Проверку экспорта
 * (ровно один билдер нужного вида) выполняет сервер при запуске: там доступны сами билдеры,
 * а здесь пришлось бы разбирать исходник. Парность файлов объявления и компонента скрипт проверяет
 * сам, потому что видит оба файла: объявление без компонента и компонент без объявления
 * останавливают генерацию.
 *
 * С флагом `--watch` скрипт после первой генерации следит за каталогом конфигурации и обновляет
 * реестры, когда файлы появляются, удаляются или переименовываются.
 *
 * Запускается Node без сборки: Node 24 удаляет аннотации типов сам, поэтому в скрипте допустим
 * только стираемый синтаксис TypeScript.
 */
import { globSync, readFileSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';

const configurationDirectory = path.resolve(import.meta.dirname, '../src/configuration');
const objectFilePattern = '**/*.{catalog,document,register,information-register}.ts';

/** Вид части конфигурации с компонентом: суффиксы её файлов и название в сообщениях в родительном падеже. */
interface ComponentPartKind {
    readonly declarationSuffix: string;
    readonly componentSuffix: string;
    readonly title: string;
}

const pageKind: ComponentPartKind = { declarationSuffix: '.page.ts', componentSuffix: '.page-component.tsx', title: 'страницы' };
const formElementKind: ComponentPartKind = {
    declarationSuffix: '.form-element.ts',
    componentSuffix: '.form-element-component.tsx',
    title: 'элемента формы',
};

/** Страница или элемент формы: пути файла объявления и файла компонента относительно каталога конфигурации. */
interface ComponentPartFiles {
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
 * Части одного вида в порядке путей объявлений. Файлы одной части различаются только суффиксом.
 * Нарушения парности добавляются в `problems`: без компонента страница не открылась бы, а элемент
 * не появился бы на форме; компонент без объявления не попал бы ни в меню, ни на форму.
 */
function findComponentParts(kind: ComponentPartKind, problems: Array<string>): Array<ComponentPartFiles> {
    const declarations = findFiles(`**/*${kind.declarationSuffix}`);
    const components = new Set(findFiles(`**/*${kind.componentSuffix}`));
    const parts = declarations.map((declaration) => {
        const component = declaration.slice(0, -kind.declarationSuffix.length) + kind.componentSuffix;
        if (!components.delete(component)) problems.push(`у объявления ${kind.title} ${declaration} нет компонента: ожидается файл ${component}`);
        return { declaration, component };
    });
    for (const component of components) {
        const declaration = component.slice(0, -kind.componentSuffix.length) + kind.declarationSuffix;
        problems.push(`у компонента ${kind.title} ${component} нет объявления: ожидается файл ${declaration}`);
    }
    return parts;
}

const header = [
    '// Файл создан командой `npm run metadata:generate`. Не редактируйте его вручную:',
    '// изменения пропадут при следующей генерации. Чтобы добавить объект конфигурации,',
    '// создайте файл *.catalog.ts, *.document.ts, *.register.ts или *.information-register.ts в src/configuration.',
    '// Чтобы добавить страницу, создайте пару файлов *.page.ts и *.page-component.tsx,',
    '// а чтобы добавить элемент формы — пару *.form-element.ts и *.form-element-component.tsx.',
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
function renderServerRegistry(objects: ReadonlyArray<string>, pages: ReadonlyArray<ComponentPartFiles>, formElements: ReadonlyArray<ComponentPartFiles>): string {
    return [
        ...header,
        "import { defineRights } from '../server/authorization/rights.js';",
        "import type { ConfigurationModule } from '../server/metadata/registry.js';",
        ...objects.map((file, index) => `import * as module${index} from '${serverImport(file)}';`),
        ...pages.map((page, index) => `import * as page${index} from '${serverImport(page.declaration)}';`),
        ...formElements.map((element, index) => `import * as formElement${index} from '${serverImport(element.declaration)}';`),
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
        '/** Модули объявлений элементов формы в порядке путей файлов. */',
        'export const formElementModules: ReadonlyArray<ConfigurationModule> = [',
        ...formElements.map((element, index) => `    { file: '${element.declaration}', exports: formElement${index} },`),
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
        ' * Ссылки на объекты конфигурации для страниц и элементов формы: `Objects.document.sample`.',
        ' * По ссылке хуки и компоненты web SDK проверяют имена полей и действий и выводят тип записи.',
        ' */',
        `export const Objects = objectReferences<[${objects.map((_file, index) => `typeof module${index}`).join(', ')}]>();`,
        '',
    ].join('\n');
}

/** Реестр компонентов клиента: откуда берётся тип его записи, имя и описание экспортируемого списка. */
interface ClientRegistry {
    readonly typeImport: string;
    readonly typeName: string;
    readonly listName: string;
    readonly comment: string;
}

const pageRegistry: ClientRegistry = {
    typeImport: '../web/application/configuration-pages',
    typeName: 'ConfigurationPageModule',
    listName: 'configurationPages',
    comment: 'Страницы конфигурации в порядке путей файлов. Компонент — экспорт по умолчанию файла компонента.',
};

const formElementRegistry: ClientRegistry = {
    typeImport: '../web/forms/form-elements',
    typeName: 'FormElementModule',
    listName: 'formElements',
    comment: 'Элементы формы в порядке путей файлов. Компонент — экспорт по умолчанию файла компонента.',
};

/** Текст реестра компонентов для клиента: объявление и компонент каждой страницы или элемента формы. */
function renderClientRegistry(registry: ClientRegistry, parts: ReadonlyArray<ComponentPartFiles>): string {
    return [
        ...header,
        `import type { ${registry.typeName} } from '${registry.typeImport}';`,
        ...parts.flatMap((part, index) => [
            `import * as declaration${index} from '${clientImport(part.declaration)}';`,
            `import Component${index} from '${clientImport(part.component)}';`,
        ]),
        '',
        `/** ${registry.comment} */`,
        `export const ${registry.listName}: ReadonlyArray<${registry.typeName}> = [`,
        ...parts.map((part, index) => `    { file: '${part.declaration}', declaration: declaration${index}, component: Component${index} },`),
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

/**
 * Обновляет реестры. Завершается `ConfigurationFilesError`, если нарушена парность файлов страниц
 * или элементов формы; тогда ни один файл не меняется.
 */
function generate(): void {
    const objects = findFiles(objectFilePattern);
    const problems: Array<string> = [];
    const pages = findComponentParts(pageKind, problems);
    const formElements = findComponentParts(formElementKind, problems);
    if (problems.length > 0) throw new ConfigurationFilesError(problems.join('\n'));
    const written = [
        writeIfChanged('configuration.generated.ts', renderServerRegistry(objects, pages, formElements)),
        writeIfChanged('objects.generated.ts', renderObjectReferences(objects)),
        writeIfChanged('pages.generated.ts', renderClientRegistry(pageRegistry, pages)),
        writeIfChanged('form-elements.generated.ts', renderClientRegistry(formElementRegistry, formElements)),
    ];
    if (written.includes(true)) {
        console.log(`Реестры конфигурации обновлены: файлов объектов ${objects.length}, страниц ${pages.length}, элементов формы ${formElements.length}`);
    }
}

/** Сообщает о нарушении соглашения о файлах; остальные ошибки считаются сбоем скрипта и идут дальше. */
function reportFilesError(error: unknown): void {
    if (!(error instanceof ConfigurationFilesError)) throw error;
    console.error(`Реестры конфигурации не обновлены:\n${error.message}`);
}

if (process.argv.includes('--watch')) {
    // В режиме слежения нарушение не останавливает скрипт: файлы страницы или элемента создаются
    // по одному, и между созданием первого и второго пара неполна. Реестры остаются прежними до исправления.
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
    console.log('Слежу за файлами объектов, страниц и элементов формы конфигурации');
} else {
    try {
        generate();
    } catch (error) {
        reportFilesError(error);
        process.exitCode = 1;
    }
}
