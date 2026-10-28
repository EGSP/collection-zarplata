/**
 * Отчёт об inline-стилях: `npm run styles:report` выводит каждое свойство `style` в компонентах
 * с файлом, строкой и значением. Нужен, чтобы находить места, которые раскладывают экран вручную,
 * вместо компонентов дизайн-системы (сетка, стек, поверхности, роли текста).
 *
 * Скрипт только сообщает и всегда завершается успешно: часть стилей допустима, например
 * `minWidth: 0` для многоточия во flex-строке. Решение о каждом месте принимает разработчик,
 * правила описаны в разделе «Компоненты и раскладка» документации.
 *
 * По умолчанию просматривается `src/configuration`. Другие каталоги передаются аргументами
 * относительно корня проекта:
 *
 * ```text
 * npm run styles:report
 * npm run styles:report -- src/web/sdk src/web/widgets
 * ```
 *
 * Скрипт разбирает текст, а не синтаксическое дерево: ему нужно только найти `style={…}` и взять
 * выражение до парной закрывающей скобки. Скобки внутри строк в стилях проекта не встречаются.
 *
 * Запускается Node без сборки, поэтому в скрипте допустим только стираемый синтаксис TypeScript.
 */
import { globSync, readFileSync } from 'node:fs';
import path from 'node:path';

const projectDirectory = path.resolve(import.meta.dirname, '..');

/** Каталоги отчёта: из аргументов командной строки или конфигурация по умолчанию. */
const directories = process.argv.length > 2 ? process.argv.slice(2) : ['src/configuration'];

/** Найденный inline-стиль: файл относительно корня, строка начала и выражение в одну строку. */
interface InlineStyle {
    readonly file: string;
    readonly line: number;
    readonly expression: string;
}

/**
 * Выражение после `style={` до парной закрывающей скобки. Выражение может занимать несколько
 * строк; в отчёт оно попадает одной строкой со сжатыми пробелами.
 */
function styleExpression(source: string, start: number): string {
    let depth = 1;
    let index = start;
    while (index < source.length && depth > 0) {
        const character = source[index];
        if (character === '{') depth += 1;
        if (character === '}') depth -= 1;
        index += 1;
    }
    return source.slice(start, index - 1).replace(/\s+/g, ' ').trim();
}

/** Все inline-стили одного файла по порядку строк. */
function fileStyles(file: string): ReadonlyArray<InlineStyle> {
    const source = readFileSync(file, 'utf8');
    const relative = path.relative(projectDirectory, file).replaceAll('\\', '/');
    const styles: InlineStyle[] = [];
    for (const match of source.matchAll(/\bstyle=\{/g)) {
        const start = match.index + match[0].length;
        const line = source.slice(0, match.index).split('\n').length;
        styles.push({ file: relative, line, expression: styleExpression(source, start) });
    }
    return styles;
}

const files = directories.flatMap((directory) => globSync('**/*.tsx', { cwd: path.resolve(projectDirectory, directory) }).map((file) => path.resolve(projectDirectory, directory, file))).sort();
const styles = files.flatMap(fileStyles);

for (const style of styles) console.log(`${style.file}:${style.line}  ${style.expression}`);
console.log(styles.length === 0
    ? `Inline-стилей нет (${directories.join(', ')}).`
    : `\nInline-стилей: ${styles.length} в ${new Set(styles.map((style) => style.file)).size} файлах (${directories.join(', ')}).`);
