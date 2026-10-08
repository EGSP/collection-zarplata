/**
 * Сборка конфигурации из сгенерированного реестра модулей.
 *
 * Реестр `configuration.generated.ts` перечисляет файлы объектов и их экспорт, но не знает,
 * какие значения файл экспортирует: генератор не разбирает исходники. Поэтому здесь из экспорта
 * каждого файла извлекается билдер и проверяется соглашение «один файл — один объект, вид объекта
 * совпадает с суффиксом файла». Без этой проверки файл без билдера молча выпал бы из конфигурации,
 * а повторный экспорт импортированного билдера дал бы непонятную ошибку о двойном объявлении.
 */
import { Effect } from 'effect';
import { isObjectBuilder, type ObjectBuilder } from './builders.js';
import { commitConfiguration } from './commit.js';
import type { ObjectDescription, ObjectKind } from './descriptions.js';
import { declaredFormElements } from './form-element-registry.js';
import { MetadataError, type MetadataProblem } from './metadata.errors.js';

/** Модуль объекта конфигурации в реестре: путь файла относительно `src/configuration` и его экспорт. */
export interface ConfigurationModule {
    readonly file: string;
    readonly exports: object;
}

/** Суффикс файла → вид объекта, который файл должен экспортировать. */
const kindsBySuffix: ReadonlyArray<readonly [suffix: string, kind: ObjectKind]> = [
    ['.catalog.ts', 'catalog'],
    ['.document.ts', 'document'],
    ['.register.ts', 'register'],
    ['.information-register.ts', 'informationRegister'],
];

/** Функции описания для сообщений: по ним видно, чем создаётся объект нужного вида. */
const kindFunctions: { readonly [Kind in ObjectKind]: string } = {
    catalog: 'catalog(...)',
    document: 'document(...)',
    register: 'register(...)',
    informationRegister: 'informationRegister(...)',
};

/** Извлекает билдер из модуля. Возвращает `null` и записывает проблему, если соглашение нарушено. */
function builderOf(module: ConfigurationModule, problems: Array<MetadataProblem>): ObjectBuilder | null {
    const object = `файл ${module.file}`;
    const builders = Object.entries(module.exports).filter(([, value]) => isObjectBuilder(value)) as Array<[string, ObjectBuilder]>;
    const expected = kindsBySuffix.find(([suffix]) => module.file.endsWith(suffix))?.[1];
    if (expected === undefined) {
        problems.push({ object, location: null, message: 'имя файла должно оканчиваться на .catalog.ts, .document.ts, .register.ts или .information-register.ts' });
        return null;
    }
    const [first, ...rest] = builders;
    if (first === undefined) {
        problems.push({ object, location: null, message: `файл не экспортирует билдер объекта; ожидается export const … = ${kindFunctions[expected]}` });
        return null;
    }
    if (rest.length > 0) {
        const names = builders.map(([name]) => name).join(', ');
        problems.push({ object, location: null, message: `файл экспортирует несколько билдеров (${names}); один файл описывает один объект` });
        return null;
    }
    const [exportName, builder] = first;
    if (builder.kind !== expected) {
        problems.push({
            object,
            location: `экспорт ${exportName}`,
            message: `ожидается ${kindFunctions[expected]} по суффиксу файла, экспортирован ${kindFunctions[builder.kind]}`,
        });
        return null;
    }
    return builder;
}

/**
 * Собирает описания всех объектов конфигурации: извлекает билдеры из модулей реестра,
 * добавляет стандартные поля и вызывает `commitConfiguration`. `formElementModules` — модули
 * объявлений элементов формы: по ним проверяются ссылки форм на элементы. Завершается
 * `MetadataError`, если нарушено соглашение о файлах или описание объекта содержит ошибки.
 * Проблемы файлов сообщаются раньше проверки описаний: без билдера файла ссылки на его объект
 * или элемент тоже не найдутся, и эти вторичные ошибки только запутали бы сообщение.
 */
export function loadConfiguration(
    modules: ReadonlyArray<ConfigurationModule>,
    formElementModules: ReadonlyArray<ConfigurationModule> = [],
): Effect.Effect<ReadonlyArray<ObjectDescription>, MetadataError> {
    return Effect.suspend(() => {
        const problems: Array<MetadataProblem> = [];
        const builders = modules.flatMap((module) => builderOf(module, problems) ?? []);
        const formElements = declaredFormElements(formElementModules, problems);
        if (problems.length > 0) return Effect.fail(new MetadataError({ problems }));
        return commitConfiguration(builders.map((builder) => builder.withStandardFields()), formElements);
    });
}
