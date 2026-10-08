/**
 * Сборка страниц конфигурации из сгенерированного реестра модулей.
 *
 * Генератор реестра находит файлы `*.page.ts` по имени и не знает, что они экспортируют. Поэтому
 * здесь из экспорта каждого файла извлекается билдер страницы и проверяется соглашение «один файл —
 * одна страница». Наличие компонента у объявления проверяет сам генератор: он видит оба файла.
 */
import { Effect } from 'effect';
import { MetadataError, type MetadataProblem } from '../metadata/metadata.errors.js';
import { checkName } from '../metadata/names.js';
import type { ConfigurationModule } from '../metadata/registry.js';
import type { PageView } from './descriptions.js';
import { isPageBuilder, type PageBuilder } from './pages.js';

/**
 * Собирает описания страниц в порядке файлов реестра. Завершается `MetadataError` со всеми
 * найденными проблемами: файл не экспортирует билдер страницы или экспортирует несколько,
 * имя страницы нарушает правила имён объектов либо повторяется. Повтор нельзя разрешить молча:
 * у двух страниц оказались бы один адрес и одно право.
 */
export function loadPages(modules: ReadonlyArray<ConfigurationModule>): Effect.Effect<ReadonlyArray<PageView>, MetadataError> {
    return Effect.suspend(() => {
        const problems: Array<MetadataProblem> = [];
        const names = new Set<string>();
        const pages = modules.flatMap((module): ReadonlyArray<PageView> => {
            const object = `файл ${module.file}`;
            const builders = Object.entries(module.exports).filter(([, value]) => isPageBuilder(value)) as Array<[string, PageBuilder]>;
            const [first, ...rest] = builders;
            if (first === undefined) {
                problems.push({ object, location: null, message: 'файл не экспортирует билдер страницы; ожидается export const … = page(...)' });
                return [];
            }
            if (rest.length > 0) {
                const exported = builders.map(([name]) => name).join(', ');
                problems.push({ object, location: null, message: `файл экспортирует несколько билдеров (${exported}); один файл описывает одну страницу` });
                return [];
            }
            const [exportName, builder] = first;
            const location = `экспорт ${exportName}`;
            const nameProblem = checkName(builder.name);
            if (nameProblem !== null) problems.push({ object, location, message: nameProblem });
            if (names.has(builder.name)) problems.push({ object, location, message: `имя страницы «${builder.name}» повторяется` });
            names.add(builder.name);
            return [{ name: builder.name, title: builder['~title'] ?? builder.name }];
        });
        return problems.length > 0 ? Effect.fail(new MetadataError({ problems })) : Effect.succeed(pages);
    });
}
