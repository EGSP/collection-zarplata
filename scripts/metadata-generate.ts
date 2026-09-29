/**
 * Генерация реестра объектов конфигурации: `npm run metadata:generate`.
 *
 * Скрипт находит файлы `src/configuration/**\/*.{catalog,document,register}.ts` и пишет
 * `src/configuration/configuration.generated.ts` с импортами этих файлов и списком модулей.
 * Объекты обнаруживаются на этапе сборки, а не при запуске: в собранном исполняемом файле нет
 * исходников `.ts`, по которым можно было бы искать файлы. Поэтому новый объект добавляется одним
 * файлом, а реестр обновляется командой, а не правкой вручную.
 *
 * Скрипт не знает, что экспортирует файл, и импортирует модуль целиком. Проверку экспорта
 * (ровно один билдер нужного вида) выполняет сервис метаданных при запуске сервера: там доступны
 * сами билдеры, а здесь пришлось бы разбирать исходник.
 *
 * С флагом `--watch` скрипт после первой генерации следит за каталогом конфигурации и обновляет
 * реестр, когда файлы объектов появляются, удаляются или переименовываются.
 *
 * Запускается Node без сборки: Node 24 удаляет аннотации типов сам, поэтому в скрипте допустим
 * только стираемый синтаксис TypeScript.
 */
import { globSync, readFileSync, watch, writeFileSync } from 'node:fs';
import path from 'node:path';

const configurationDirectory = path.resolve(import.meta.dirname, '../src/configuration');
const outputFile = path.join(configurationDirectory, 'configuration.generated.ts');
const objectFilePattern = '**/*.{catalog,document,register}.ts';

/** Пути файлов объектов относительно каталога конфигурации, с `/` и в стабильном порядке. */
function findObjectFiles(): Array<string> {
    return globSync(objectFilePattern, { cwd: configurationDirectory })
        .map((file) => file.split(path.sep).join('/'))
        .sort();
}

/** Текст реестра. Порядок файлов отсортирован, чтобы повторная генерация давала тот же текст. */
function render(files: ReadonlyArray<string>): string {
    const imports = files.map((file, index) => `import * as module${index} from './${file.replace(/\.ts$/, '.js')}';`);
    const entries = files.map((file, index) => `    { file: '${file}', exports: module${index} },`);
    return [
        '// Файл создан командой `npm run metadata:generate`. Не редактируйте его вручную:',
        '// изменения пропадут при следующей генерации. Чтобы добавить объект конфигурации,',
        '// создайте файл *.catalog.ts, *.document.ts или *.register.ts в src/configuration.',
        "import type { ConfigurationModule } from '../server/metadata/registry.js';",
        ...imports,
        '',
        '/** Модули объектов конфигурации в порядке путей файлов. */',
        'export const configurationModules: ReadonlyArray<ConfigurationModule> = [',
        ...entries,
        '];',
        '',
    ].join('\n');
}

/**
 * Пишет реестр, только если текст изменился. Лишняя запись заставила бы `tsc --watch`
 * пересобрать сервер, а `node --watch` — перезапустить его без причины.
 */
function generate(): void {
    const files = findObjectFiles();
    const content = render(files);
    let current: string | null = null;
    try {
        current = readFileSync(outputFile, 'utf8');
    } catch {
        // Файла ещё нет: первая генерация в новом клоне или worktree.
    }
    if (current === content) return;
    writeFileSync(outputFile, content);
    console.log(`Реестр конфигурации обновлён: файлов объектов ${files.length}`);
}

generate();

if (process.argv.includes('--watch')) {
    let timer: NodeJS.Timeout | undefined;
    // Имена файлов из событий не фильтруются: при удалении каталога событие приходит с именем
    // каталога, а не файлов объектов. Поиск файлов дешёвый, а неизменный реестр не перезаписывается.
    // Редактор при сохранении даёт несколько событий подряд; достаточно одной генерации после них.
    watch(configurationDirectory, { recursive: true }, () => {
        clearTimeout(timer);
        timer = setTimeout(generate, 100);
    });
    console.log('Слежу за файлами объектов конфигурации');
}
