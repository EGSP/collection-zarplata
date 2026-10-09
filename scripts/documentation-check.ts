/**
 * Проверка связи документации с кодом: `npm run docs:check`, а также `npm run typecheck`.
 *
 * Раздел документации перечисляет в служебном заголовке файла шаблоны путей кода, который он
 * описывает:
 *
 *     ---
 *     covers:
 *       - src/server/data/**
 *     ---
 *
 * Скрипт сравнивает ветку с базовой и называет разделы, код которых изменился. Так исполнитель
 * видит, какие разделы пересмотреть, не вспоминая, где описан изменённый модуль.
 *
 * Изменённый код не делает раздел устаревшим сам по себе: правка часто не меняет описанного
 * поведения. Поэтому такие разделы скрипт только перечисляет и завершается успешно. Ошибкой он
 * считает шаблон, которому не соответствует ни один файл: код переехал или удалён, а раздел
 * по-прежнему ссылается на старое место, и связь перестала что-либо проверять.
 *
 * Изменениями считаются коммиты ветки после расхождения с базовой, незакоммиченные правки и новые
 * файлы. Базовая ветка — `main`; другую задаёт параметр `--base=<ветка>`.
 *
 * Запускается Node без сборки, поэтому в скрипте допустим только стираемый синтаксис TypeScript.
 */
import { execFileSync } from 'node:child_process';
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const documentationDirectory = 'docs';

/** Раздел документации и шаблоны путей кода, который он описывает. */
interface Section {
    /** Путь файла раздела от корня проекта. */
    readonly file: string;
    readonly title: string;
    readonly patterns: ReadonlyArray<string>;
}

/** Пути в выводе git и в шаблонах пишутся через прямую косую черту на любой системе. */
function portablePath(filePath: string): string {
    return filePath.replaceAll('\\', '/');
}

/**
 * Шаблоны из служебного заголовка раздела. Заголовок разбирается построчно, без библиотеки YAML:
 * скрипту нужен только список строк `covers`, а зависимость ради него подключать не стоит.
 * Список в одну строку (`covers: [a, b]`) не поддерживается и считается ошибкой, иначе раздел
 * с такой записью молча выпал бы из проверки.
 */
function readSection(file: string, errors: Array<string>): Section {
    const lines = readFileSync(path.join(projectRoot, file), 'utf8').split(/\r?\n/);
    const title = lines.find((line) => line.startsWith('# '))?.slice(2) ?? file;
    const patterns: Array<string> = [];
    if (lines[0] !== '---') return { file, title, patterns };

    let insideCovers = false;
    for (const line of lines.slice(1)) {
        if (line === '---') break;
        const item = /^\s+-\s+(.+?)\s*$/.exec(line);
        if (insideCovers && item?.[1] !== undefined) {
            patterns.push(item[1].replace(/^(['"])(.*)\1$/, '$2'));
        } else if (line === 'covers:') {
            insideCovers = true;
        } else if (line.startsWith('covers:')) {
            errors.push(`${file}: шаблоны covers записываются списком, по одному на строке с «- »`);
        } else {
            insideCovers = false;
        }
    }
    return { file, title, patterns };
}

function git(...parameters: ReadonlyArray<string>): string {
    return execFileSync('git', parameters, { cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Файлы, изменённые относительно базовой ветки, или `undefined`, если сравнить не с чем: базовой
 * ветки нет в репозитории. Три точки сравнивают с точкой расхождения, а не с вершиной базовой
 * ветки: иначе чужие коммиты, появившиеся в ней позже, выглядели бы изменениями этой ветки.
 */
function changedFiles(base: string): ReadonlySet<string> | undefined {
    try {
        const output = [
            // Имена с кириллицей git по умолчанию выводит в кавычках с кодами символов.
            git('-c', 'core.quotePath=false', 'diff', '--name-only', `${base}...HEAD`),
            git('-c', 'core.quotePath=false', 'diff', '--name-only', 'HEAD'),
            git('-c', 'core.quotePath=false', 'ls-files', '--others', '--exclude-standard'),
        ].join('\n');
        return new Set(output.split(/\r?\n/).filter((line) => line !== ''));
    } catch {
        return undefined;
    }
}

const baseParameter = process.argv.slice(2).find((parameter) => parameter.startsWith('--base='));
const base = baseParameter?.slice('--base='.length) || 'main';

const errors: Array<string> = [];
const sections = globSync(`${documentationDirectory}/*.md`, { cwd: projectRoot })
    .map(portablePath)
    .sort()
    .map((file) => readSection(file, errors));

for (const section of sections) {
    for (const pattern of section.patterns) {
        if (globSync(pattern, { cwd: projectRoot }).length === 0) {
            errors.push(`${section.file}: шаблону «${pattern}» не соответствует ни один файл. Исправьте путь или удалите шаблон`);
        }
    }
}

const changed = changedFiles(base);
if (changed === undefined) {
    console.log(`Документация: ветка «${base}» не найдена, изменения не сравнивались. Укажите базовую ветку параметром --base.`);
} else {
    const affected = sections
        .map((section) => ({
            section,
            files: [...changed].filter((file) => section.patterns.some((pattern) => path.matchesGlob(file, pattern))).sort(),
        }))
        .filter(({ files }) => files.length > 0);

    if (affected.length === 0) {
        console.log(`Документация: изменения относительно «${base}» не затрагивают код, описанный в разделах.`);
    } else {
        console.log(`Документация: относительно «${base}» изменён код, описанный в разделах.`);
        for (const { section, files } of affected) {
            const state = changed.has(section.file) ? 'раздел изменён' : 'раздел не изменён, пересмотрите его';
            console.log(`\n${section.title} — ${section.file} (${state})`);
            for (const file of files) console.log(`  ${file}`);
        }
        console.log('');
    }
}

if (errors.length > 0) {
    console.error(`Ошибки связи документации с кодом:\n${errors.map((error) => `  ${error}`).join('\n')}`);
    process.exit(1);
}
