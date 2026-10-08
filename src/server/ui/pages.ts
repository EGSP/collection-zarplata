/**
 * Объявление страницы конфигурации: имя и заголовок собственного экрана.
 *
 * Страница — экран, который не сводится к списку или форме объекта, например рабочее место.
 * Она состоит из двух частей. Объявление описывается билдером в файле `*.page.ts`, компонент
 * React лежит в соседнем файле `*.page-component.tsx`. Части разделены, потому что сервер
 * собирает конфигурацию без React и DOM, а имя и заголовок страницы нужны ему для меню и прав.
 *
 * Файл объявления импортирует и клиент: по нему реестр компонентов узнаёт имя страницы. Поэтому
 * здесь нет импортов Nest и Effect, а проверка объявлений вынесена в `page-registry.ts`.
 */

/** Вид страницы в схеме оболочки и в ключе права. С видами объектов конфигурации не совпадает. */
export const pageKind = 'page';

/**
 * Билдер страницы; его создаёт `page(name)`. Неизменяем, как и билдеры объектов. `Name` хранит
 * имя литералом: по нему выводится тип права `Rights.page.<имя>.open`.
 */
export class PageBuilder<Name extends string = string> {
    readonly kind = pageKind;
    readonly name: Name;
    readonly '~title': string | null;

    constructor(name: Name, title: string | null = null) {
        this.name = name;
        this['~title'] = title;
    }

    /** Заголовок страницы в меню и на вкладке. Если он не задан, используется имя. */
    title(title: string): PageBuilder<Name> {
        return new PageBuilder(this.name, title);
    }
}

/**
 * Страница с именем `name`. Имя входит в адрес `/page/<имя>` и в ключ права, пользователь видит
 * заголовок. Имя подчиняется правилам имён объектов; их проверяет сервер при запуске.
 */
export function page<const Name extends string>(name: Name): PageBuilder<Name> {
    return new PageBuilder(name);
}

/**
 * Проверяет, что значение — билдер страницы. Экспорт файла объявления известен только во время
 * выполнения, и кроме билдера файл может экспортировать вспомогательные значения.
 */
export function isPageBuilder(value: unknown): value is PageBuilder {
    return value instanceof PageBuilder;
}
