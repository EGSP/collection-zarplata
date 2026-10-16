/**
 * Объявления собственных форм объекта: списка, формы записи и формы новой записи.
 *
 * Собственная форма заменяет стандартную форму одного вида целиком. Каждый вид переопределяется
 * явно: объявленная форма записи не заменяет форму новой записи, и наоборот. Модальность видом
 * формы не является: форму записи и форму новой записи область окна показывает во вкладке или
 * в модальном окне и сообщает ей место показа.
 *
 * Объявление читает и сервер, и клиент, поэтому оно не зависит от React. Сервер по объявлениям
 * проверяет при запуске цели и повторы, клиент по ним выбирает компонент формы.
 */
import type { ObjectReference } from '../../common/object-reference.js';
import type { ObjectKind } from './descriptions.js';
import type { MetadataProblem } from './metadata.errors.js';
import type { ConfigurationModule } from './registry.js';

/**
 * Вид формы объекта: `list` — список, `record` — форма существующей записи, `new` — форма новой записи.
 */
export type ObjectFormKind = 'list' | 'record' | 'new';

/** Объявление собственной формы одного вида для одного объекта. */
export class ObjectFormDefinition<Kind extends ObjectFormKind = ObjectFormKind> {
    constructor(readonly object: ObjectReference, readonly kind: Kind) {}
}

/**
 * Объявляет собственную форму объекта. Компонент формы экспортируется по умолчанию из соседнего
 * файла `*.object-form-component.tsx`; его свойства проверяются по виду формы при сборке клиента.
 */
export function defineObjectForm<const Kind extends ObjectFormKind>(definition: { readonly object: ObjectReference; readonly kind: Kind }): ObjectFormDefinition<Kind> {
    return new ObjectFormDefinition(definition.object, definition.kind);
}

/** Отличает объявление формы от вспомогательных экспортов файла. */
export function isObjectFormDefinition(value: unknown): value is ObjectFormDefinition {
    return value instanceof ObjectFormDefinition;
}

/** Объект конфигурации, известный проверке форм: вид и имя. */
interface ObjectIdentity {
    readonly kind: ObjectKind;
    readonly name: string;
}

const kindTitles: Record<ObjectFormKind, string> = { list: 'список', record: 'форма записи', new: 'форма новой записи' };

/**
 * Извлекает объявления форм из модулей реестра и проверяет их. Проблемы добавляются в `problems`:
 * файл не экспортирует объявление или экспортирует несколько, вид формы неизвестен, объекта нет,
 * у объекта нет формы записи, форма одного вида объявлена для объекта дважды. Повтор нельзя
 * разрешить молча: клиент не знал бы, какой из двух компонентов показать.
 */
export function declaredObjectForms(
    modules: ReadonlyArray<ConfigurationModule>,
    objects: ReadonlyArray<ObjectIdentity>,
    problems: Array<MetadataProblem>,
): ReadonlyArray<ObjectFormDefinition> {
    const declared = new Map<string, string>();
    const definitions: ObjectFormDefinition[] = [];
    for (const module of modules) {
        const file = `файл ${module.file}`;
        const found = Object.entries(module.exports).filter(([, value]) => isObjectFormDefinition(value)) as Array<[string, ObjectFormDefinition]>;
        const [first, ...rest] = found;
        if (first === undefined) {
            problems.push({ object: file, location: null, message: 'файл не экспортирует объявление формы объекта; ожидается export const … = defineObjectForm(...)' });
            continue;
        }
        if (rest.length > 0) {
            problems.push({ object: file, location: null, message: `файл экспортирует несколько объявлений (${found.map(([name]) => name).join(', ')}); один файл описывает одну форму` });
            continue;
        }
        const [exportName, definition] = first;
        const location = `экспорт ${exportName}`;
        const { object, kind } = definition;
        if (!(kind in kindTitles)) {
            problems.push({ object: file, location, message: `неизвестный вид формы «${String(kind)}»; ожидается list, record или new` });
            continue;
        }
        if (!objects.some((candidate) => candidate.kind === object.kind && candidate.name === object.name)) {
            problems.push({ object: file, location, message: `объекта ${object.kind} ${object.name} нет в конфигурации` });
            continue;
        }
        // Список есть у всех объектов, форма записи только у справочников и документов.
        if (kind !== 'list' && object.kind !== 'catalog' && object.kind !== 'document') {
            problems.push({ object: file, location, message: `у объекта ${object.kind} ${object.name} нет формы записи` });
            continue;
        }
        const key = `${object.kind} ${object.name}/${kind}`;
        const previous = declared.get(key);
        if (previous !== undefined) {
            problems.push({ object: file, location, message: `${kindTitles[kind]} объекта ${object.kind} ${object.name} уже объявлена в файле ${previous}` });
            continue;
        }
        declared.set(key, module.file);
        definitions.push(definition);
    }
    return definitions;
}
