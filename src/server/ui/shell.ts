/**
 * Схема оболочки: подсистемы, их группы и ссылки на объекты конфигурации.
 *
 * Схема — часть конфигурации, как объекты и роли: платформа не знает, как конкретному магазину
 * удобно разложить объекты по разделам. Она описывается билдером в `src/configuration/shell.ts`.
 *
 * Содержимое подсистемы — список ссылок, а не владение: один объект можно указать в нескольких
 * группах и подсистемах, а объект, не указанный нигде, остаётся доступным по адресу.
 *
 * Вся проверка схемы выполняется типами, поэтому у билдера нет шага сборки с ошибками, как
 * `commit()` у объектов: объект указывается импортированным билдером, а имена подсистем
 * накапливаются в параметре типа, и повтор имени не компилируется.
 */
import type { ObjectBuilder } from '../metadata/builders.js';
import type { ShellGroup, ShellObject, ShellSubsystem, ShellView } from './descriptions.js';

/** Билдер подсистемы: заголовок и группы. Неизменяем, как и билдеры объектов. */
export class SubsystemBuilder {
    readonly '~title': string | null;
    readonly '~groups': ReadonlyArray<ShellGroup>;

    constructor(title: string | null = null, groups: ReadonlyArray<ShellGroup> = []) {
        this['~title'] = title;
        this['~groups'] = groups;
    }

    /** Заголовок подсистемы в интерфейсе. Если он не задан, используется имя. */
    title(title: string): SubsystemBuilder {
        return new SubsystemBuilder(title, this['~groups']);
    }

    /**
     * Группа объектов с заголовком; объекты показываются в указанном порядке. Объект передаётся
     * билдером из файла объекта, поэтому опечатка в имени невозможна, а строка не компилируется.
     */
    group(title: string, objects: ReadonlyArray<ObjectBuilder>): SubsystemBuilder {
        const group: ShellGroup = { title, objects: objects.map((object): ShellObject => ({ kind: object.kind, name: object.name })) };
        return new SubsystemBuilder(this['~title'], [...this['~groups'], group]);
    }
}

/**
 * Билдер оболочки; его создаёт `shell()`. `Names` — имена уже объявленных подсистем: по ним
 * TypeScript отклоняет повтор имени.
 */
export class ShellBuilder<Names extends string = never> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~names': Names;
    readonly '~subsystems': ReadonlyArray<ShellSubsystem>;

    constructor(subsystems: ReadonlyArray<ShellSubsystem> = []) {
        this['~subsystems'] = subsystems;
    }

    /**
     * Подсистема с именем `name`. Имя отличает подсистему от остальных и не показывается
     * пользователю. Повтор имени — ошибка компиляции: тип параметра для него становится `never`.
     */
    subsystem<const Name extends string>(
        name: Name & (Name extends Names ? never : unknown),
        define: (subsystem: SubsystemBuilder) => SubsystemBuilder,
    ): ShellBuilder<Names | Name> {
        const subsystem = define(new SubsystemBuilder());
        return new ShellBuilder([...this['~subsystems'], { name, title: subsystem['~title'] ?? name, groups: subsystem['~groups'] }]);
    }
}

/** Пустая оболочка, к которой добавляются подсистемы. */
export function shell(): ShellBuilder {
    return new ShellBuilder();
}

/**
 * Схема оболочки для одного пользователя: в ней остаются только объекты, для которых `readable`
 * возвращает `true`. Группа без таких объектов и подсистема без групп в результат не попадают:
 * пустой раздел показал бы пользователю, что от него что-то скрыто. По той же причине не
 * попадает и группа, которая пуста уже в конфигурации.
 */
export function restrictShell(builder: ShellBuilder<string>, readable: (object: ShellObject) => boolean): ShellView {
    const subsystems = builder['~subsystems'].flatMap((subsystem): ReadonlyArray<ShellSubsystem> => {
        const groups = subsystem.groups.flatMap((group): ReadonlyArray<ShellGroup> => {
            const objects = group.objects.filter(readable);
            return objects.length === 0 ? [] : [{ ...group, objects }];
        });
        return groups.length === 0 ? [] : [{ ...subsystem, groups }];
    });
    return { subsystems };
}
