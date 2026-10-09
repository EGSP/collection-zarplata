/**
 * Настройка сайта документации. VitePress собирает файлы каталога `docs` в `dist/docs`,
 * откуда их отдаёт сервер приложения по адресу `/docs`.
 *
 * Меню сайта не ведётся вручную: порядок разделов берётся из оглавления в корневом
 * ARCHITECTURE.md, а подразделы — из заголовков самих файлов. Поэтому новый раздел достаточно
 * добавить файлом и строкой оглавления, и меню не расходится с тем, что читатель видит на GitHub.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type DefaultTheme } from 'vitepress';

const documentationRoot = path.resolve(import.meta.dirname, '..');

/**
 * Якорь заголовка по правилу GitHub: строчные буквы, знаки препинания удалены, пробелы заменены
 * дефисами. Собственное правило VitePress убирает надстрочные знаки и превращает «й» в «и»,
 * поэтому ссылка на подраздел работала бы на сайте и не работала бы на GitHub или наоборот.
 */
function githubAnchor(title: string): string {
    return title.trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, '').replace(/ /g, '-');
}

/** Заголовки второго уровня из файла раздела. Строки внутри блоков кода заголовками не считаются. */
function subsectionTitles(fileName: string): ReadonlyArray<string> {
    const titles: Array<string> = [];
    let insideCode = false;
    for (const line of readFileSync(path.join(documentationRoot, fileName), 'utf8').split(/\r?\n/)) {
        if (/^\s*```/.test(line)) insideCode = !insideCode;
        const heading = insideCode ? null : /^## (.+)$/.exec(line);
        if (heading?.[1] !== undefined) titles.push(heading[1]);
    }
    return titles;
}

/** Меню разделов в порядке оглавления ARCHITECTURE.md; подразделы свёрнуты под своим разделом. */
function sidebar(): Array<DefaultTheme.SidebarItem> {
    const contents = readFileSync(path.resolve(documentationRoot, '../ARCHITECTURE.md'), 'utf8');
    return [...contents.matchAll(/^- \[(.+)\]\(docs\/(.+)\.md\)$/gm)].map((entry) => {
        const title = entry[1] ?? '';
        const name = entry[2] ?? '';
        const subsections = subsectionTitles(`${name}.md`);
        return {
            text: title,
            link: `/${name}`,
            ...(subsections.length === 0 ? {} : {
                collapsed: true,
                items: subsections.map((subsection) => ({
                    text: subsection,
                    link: `/${name}#${githubAnchor(subsection)}`,
                })),
            }),
        };
    });
}

export default defineConfig({
    lang: 'ru-RU',
    title: 'Учёт зарплаты и продаж',
    description: 'Документация приложения для учёта зарплаты и продаж магазина',
    base: '/docs/',
    outDir: '../dist/docs',
    markdown: {
        anchor: { slugify: githubAnchor },
        headers: { slugify: githubAnchor },
        toc: { slugify: githubAnchor },
    },
    themeConfig: {
        sidebar: sidebar(),
        outline: { level: [2, 3], label: 'На этой странице' },
        docFooter: { prev: 'Предыдущий раздел', next: 'Следующий раздел' },
        darkModeSwitchLabel: 'Оформление',
        lightModeSwitchTitle: 'Включить светлое оформление',
        darkModeSwitchTitle: 'Включить тёмное оформление',
        sidebarMenuLabel: 'Разделы',
        returnToTopLabel: 'К началу страницы',
        notFound: {
            title: 'Страница не найдена',
            quote: 'В документации нет страницы с таким адресом. Возможно, раздел переименован или ссылка устарела.',
            linkLabel: 'Перейти к оглавлению',
            linkText: 'К оглавлению',
        },
        search: {
            provider: 'local',
            options: {
                translations: {
                    button: { buttonText: 'Поиск', buttonAriaLabel: 'Поиск' },
                    modal: {
                        displayDetails: 'Показать подробный список',
                        resetButtonTitle: 'Очистить запрос',
                        backButtonTitle: 'Закрыть поиск',
                        noResultsText: 'Ничего не найдено по запросу',
                        footer: {
                            selectText: 'выбрать',
                            navigateText: 'перейти',
                            closeText: 'закрыть',
                        },
                    },
                },
            },
        },
    },
});
