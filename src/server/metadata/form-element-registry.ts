/**
 * Сборка перечня элементов формы из сгенерированного реестра модулей.
 *
 * Генератор реестра находит файлы `*.form-element.ts` по имени и не знает, что они экспортируют.
 * Поэтому здесь из экспорта каждого файла извлекается билдер элемента и проверяется соглашение
 * «один файл — один элемент». Наличие компонента у объявления проверяет сам генератор: он видит
 * оба файла.
 *
 * Перечень нужен проверке форм: элемент, созданный вне файла объявления, в реестр клиента
 * не попадает, и форма со ссылкой на него осталась бы без компонента.
 */
import { isFormElementBuilder, type FormElementBuilder } from './form-elements.js';
import type { MetadataProblem } from './metadata.errors.js';
import { checkName } from './names.js';
import type { ConfigurationModule } from './registry.js';

/**
 * Имена объявленных элементов формы. Проблемы объявлений добавляются в `problems`: файл
 * не экспортирует билдер элемента или экспортирует несколько, имя нарушает правила имён объектов
 * либо повторяется. Повтор нельзя разрешить молча: у двух элементов оказался бы один компонент.
 */
export function declaredFormElements(modules: ReadonlyArray<ConfigurationModule>, problems: Array<MetadataProblem>): ReadonlySet<string> {
    const names = new Set<string>();
    for (const module of modules) {
        const object = `файл ${module.file}`;
        const builders = Object.entries(module.exports).filter(([, value]) => isFormElementBuilder(value)) as Array<[string, FormElementBuilder]>;
        const [first, ...rest] = builders;
        if (first === undefined) {
            problems.push({ object, location: null, message: 'файл не экспортирует билдер элемента формы; ожидается export const … = formElement(...)' });
            continue;
        }
        if (rest.length > 0) {
            const exported = builders.map(([name]) => name).join(', ');
            problems.push({ object, location: null, message: `файл экспортирует несколько билдеров (${exported}); один файл описывает один элемент формы` });
            continue;
        }
        const [exportName, builder] = first;
        const location = `экспорт ${exportName}`;
        const nameProblem = checkName(builder.name);
        if (nameProblem !== null) problems.push({ object, location, message: nameProblem });
        if (names.has(builder.name)) problems.push({ object, location, message: `имя элемента формы «${builder.name}» повторяется` });
        names.add(builder.name);
    }
    return names;
}
