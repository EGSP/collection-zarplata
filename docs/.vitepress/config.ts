/**
 * Настройка сайта документации. VitePress собирает файлы каталога `docs` в `dist/docs`,
 * откуда их отдаёт сервер приложения по адресу `/docs`.
 *
 * Настройка задаёт порядок разделов и их дочерних страниц. Пункты подразделов строятся
 * из заголовков Markdown. Перед архитектурой в меню стоит раздел «Правила учёта».
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig, type DefaultTheme } from 'vitepress';
import { withMermaid } from 'vitepress-plugin-mermaid';

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

/** Раздел бизнес-правил магазина открывает меню документации. */
const accountingRules = { title: 'Правила учёта', name: 'accounting-rules' };

/** Дочерние страницы правил учёта: условия изменения и отмены продажи и два отчёта о деньгах. */
const saleEditingRules = { title: 'Правила редактирования продаж', name: 'sale-editing-rules' };
const periodSummaryRules = { title: 'Сводка за период', name: 'accounting-rules/period-summary' };
const cashSummaryRules = { title: 'Кассовая сводка', name: 'accounting-rules/cash-summary' };

/** Пункты меню для подразделов файла раздела. */
function subsectionItems(name: string): Array<DefaultTheme.SidebarItem> {
    return subsectionTitles(`${name}.md`).map((subsection) => ({
        text: subsection,
        link: `/${name}#${githubAnchor(subsection)}`,
    }));
}

/** Пункт меню страницы: её подразделы, затем дочерние страницы, свёрнутые под ней. */
function pageItem(title: string, name: string, children: ReadonlyArray<DefaultTheme.SidebarItem> = []): DefaultTheme.SidebarItem {
    const items = [...subsectionItems(name), ...children];
    return { text: title, link: `/${name}`, ...(items.length === 0 ? {} : { collapsed: true, items }) };
}

/** Порядок разделов архитектуры и дочерних страниц в меню. */
function architectureSections(): Array<DefaultTheme.SidebarItem> {
    return [
        pageItem('Принципы', 'principles'),
        pageItem('Стек', 'stack'),
        pageItem('Структура проекта', 'project-structure'),
        pageItem('Метаданные', 'metadata'),
        pageItem('База данных', 'database'),
        pageItem('Резервное копирование', 'backup'),
        pageItem('API данных', 'single-endpoint'),
        pageItem('Вход в приложение', 'authentication'),
        pageItem('Права (RBAC)', 'authorization'),
        pageItem('Политики записи', 'write-policies'),
        pageItem('Журнал действий', 'journal'),
        pageItem('Первичные данные', 'initial-data'),
        pageItem('Интерфейс (SDUI)', 'interface', [
            pageItem('Описания интерфейса', 'interface/descriptions'),
            pageItem('Оболочка и навигация', 'interface/shell'),
            pageItem('Формы записей', 'interface/forms'),
            pageItem('Списки и ссылки', 'interface/lists-and-references'),
        ]),
        pageItem('Web SDK', 'web-sdk', [
            pageItem('Хуки', 'web-sdk/hooks'),
            pageItem('Компоненты', 'web-sdk/components'),
            pageItem('Поля ввода', 'web-sdk/fields'),
            pageItem('Функции и типы', 'web-sdk/functions-and-types'),
        ]),
        pageItem('Компоненты и раскладка', 'components'),
        pageItem('Сборка и запуск', 'build-and-launch'),
        pageItem('Инструменты разработки', 'development-tools'),
        pageItem('Документация', 'documentation'),
        pageItem('Поставка', 'delivery'),
        pageItem('Версии', 'versions'),
        pageItem('Импорт из универсальной XML-выгрузки 1С', '1c-xml-import'),
    ];
}

/**
 * Меню сайта из двух групп. Правила учёта стоят первыми и раскрыты: их читает не только
 * разработчик, и искать их под разделами архитектуры было бы неудобно.
 */
function sidebar(): Array<DefaultTheme.SidebarItem> {
    return [
        { text: accountingRules.title, link: `/${accountingRules.name}`, items: [...subsectionItems(accountingRules.name), pageItem(saleEditingRules.title, saleEditingRules.name), pageItem(periodSummaryRules.title, periodSummaryRules.name), pageItem(cashSummaryRules.title, cashSummaryRules.name)] },
        { text: 'Архитектура', link: '/', items: architectureSections() },
    ];
}

/**
 * Обёртка плагина Mermaid превращает блоки кода `mermaid` в схемы. GitHub рисует такие блоки сам,
 * поэтому схема видна и на сайте, и в репозитории, а её исходник остаётся текстом раздела.
 */
export default withMermaid(defineConfig({
    lang: 'ru-RU',
    title: 'Учёт зарплаты и продаж',
    description: 'Документация приложения для учёта зарплаты и продаж магазина',
    base: '/docs/',
    // Подписи схем выводятся текстом SVG, а не вложенным HTML: стили сайта меняют высоту строки
    // вложенного HTML уже после расчёта размеров, и подпись в две строки обрезалась бы снизу.
    mermaid: { htmlLabels: false, flowchart: { htmlLabels: false } },
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
}));
