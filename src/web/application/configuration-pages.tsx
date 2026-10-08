/**
 * Страницы конфигурации на клиенте: собственные экраны, которые не сводятся к списку или форме объекта.
 *
 * Компонент страницы попадает в клиент при сборке, а не через `/api/metadata`: реестр страниц
 * `pages.generated.ts` создаёт генератор по файлам `src/configuration`. Сервер сообщает только,
 * какие страницы пользователю доступны и как они называются. Поэтому страница открывается,
 * только если есть и в реестре, и в ответе сервера.
 */
import type { ComponentType } from 'react';
import { useParams } from 'react-router';
import { configurationPages } from '../../configuration/pages.generated';
import { isPageBuilder } from '../../server/ui/pages';
import { NotFoundPage } from '../common/not-found';
import { useMetadata } from '../data-provider/metadata';
import { useWindowTitle } from '../window/window-scope';

/** Страница конфигурации в реестре клиента. */
export interface ConfigurationPageModule {
    /** Путь файла объявления относительно `src/configuration`. */
    readonly file: string;
    /** Экспорт файла объявления: из него берётся имя страницы. */
    readonly declaration: object;
    /** Компонент страницы: экспорт по умолчанию файла компонента. Свойств страница не получает. */
    readonly component: ComponentType;
}

/**
 * Компоненты страниц по именам. Соглашение об экспорте объявления проверяет сервер при запуске,
 * поэтому файл без билдера страницы здесь пропускается: сервер с такой конфигурацией не запустится.
 */
const components: ReadonlyMap<string, ComponentType> = new Map(
    configurationPages.flatMap((page) => {
        const builder = Object.values(page.declaration).find(isPageBuilder);
        return builder === undefined ? [] : [[builder.name, page.component] as const];
    }),
);

/**
 * Страница вкладки по адресу `/page/<имя>`. Страница ищется среди тех, что сервер отдал
 * пользователю: страница, которой нет в конфигурации, и страница без права для клиента неразличимы.
 */
export function ConfigurationPage() {
    const { name } = useParams();
    const page = useMetadata().data?.pages.find((candidate) => candidate.name === name);
    const Component = page === undefined ? undefined : components.get(page.name);
    if (page === undefined || Component === undefined) return <NotFoundPage />;
    return (
        <>
            {/* Эффекты соседних компонентов выполняются по порядку, поэтому заголовок из объявления
                задаётся раньше заголовка, который сообщает сама страница, и не заменяет его. */}
            <DeclaredTabTitle title={page.title} />
            <Component />
        </>
    );
}

/** Задаёт вкладке заголовок из объявления страницы: он виден, пока страница не задала заголовок сама. */
function DeclaredTabTitle({ title }: { readonly title: string }) {
    useWindowTitle(title);
    return null;
}
