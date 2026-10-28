/**
 * Схема оболочки: подсистемы, их группы и ссылки на объекты и страницы конфигурации.
 *
 * Схема — часть конфигурации, как объекты и роли: платформа не знает, как конкретному магазину
 * удобно разложить объекты по разделам. Она описывается билдером в `src/configuration/shell.ts`.
 *
 * Содержимое подсистемы — список ссылок, а не владение: один объект или страницу можно указать
 * в нескольких группах и подсистемах, а не указанные нигде остаются доступными по адресу.
 *
 * Вся проверка схемы выполняется типами, поэтому у билдера нет шага сборки с ошибками, как
 * `commit()` у объектов: объект и страница указываются импортированными билдерами, а имена
 * подсистем накапливаются в параметре типа, и повтор имени не компилируется.
 */
import type { ObjectBuilder } from '../metadata/builders.js';
import type { ShellGroup, ShellItem, ShellSubsystem, ShellView, SubsystemIcon } from './descriptions.js';
import { pageKind, type PageBuilder } from './pages.js';

/** Билдер подсистемы: заголовок, иконка и группы. Неизменяем, как и билдеры объектов. */
export class SubsystemBuilder {
    readonly '~title': string | null;
    readonly '~icon': SubsystemIcon | null;
    readonly '~groups': ReadonlyArray<ShellGroup>;

    constructor(title: string | null = null, icon: SubsystemIcon | null = null, groups: ReadonlyArray<ShellGroup> = []) {
        this['~title'] = title;
        this['~icon'] = icon;
        this['~groups'] = groups;
    }

    /** Заголовок подсистемы в интерфейсе. Если он не задан, используется имя. */
    title(title: string): SubsystemBuilder {
        return new SubsystemBuilder(title, this['~icon'], this['~groups']);
    }

    /**
     * Иконка подсистемы в боковом меню. На узком окне меню сворачивается в полосу иконок,
     * и подсистему узнают по ней, а заголовок виден в подсказке.
     */
    icon(icon: SubsystemIcon): SubsystemBuilder {
        return new SubsystemBuilder(this['~title'], icon, this['~groups']);
    }

    /**
     * Группа с заголовком; объекты и страницы показываются в указанном порядке. Пункт передаётся
     * билдером из файла объекта или объявления страницы, поэтому опечатка в имени невозможна,
     * а строка не компилируется.
     */
    group(title: string, items: ReadonlyArray<ObjectBuilder | PageBuilder>): SubsystemBuilder {
        const group: ShellGroup = { title, items: items.map((item): ShellItem => ({ kind: item.kind, name: item.name })) };
        return new SubsystemBuilder(this['~title'], this['~icon'], [...this['~groups'], group]);
    }
}

/**
 * Билдер оболочки; его создаёт `shell()`. `Names` — имена уже объявленных подсистем: по ним
 * TypeScript отклоняет повтор имени.
 */
export class ShellBuilder<Names extends string = never> {
    /** Только для вывода типов: во время выполнения свойства нет. */
    declare readonly '~names': Names;
    readonly '~workplaces': ReadonlyArray<string>;
    readonly '~subsystems': ReadonlyArray<ShellSubsystem>;

    constructor(workplaces: ReadonlyArray<string> = [], subsystems: ReadonlyArray<ShellSubsystem> = []) {
        this['~workplaces'] = workplaces;
        this['~subsystems'] = subsystems;
    }

    /**
     * Рабочие места: страницы, которые боковая панель выводит над подсистемами в указанном порядке.
     * Страница передаётся билдером, как и пункт группы. Повторный вызов добавляет страницы к уже
     * перечисленным. Страница может одновременно стоять и в группе подсистемы.
     */
    workplaces(pages: ReadonlyArray<PageBuilder>): ShellBuilder<Names> {
        return new ShellBuilder([...this['~workplaces'], ...pages.map((page) => page.name)], this['~subsystems']);
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
        const icon = subsystem['~icon'];
        const described: ShellSubsystem = { name, title: subsystem['~title'] ?? name, ...(icon === null ? {} : { icon }), groups: subsystem['~groups'] };
        return new ShellBuilder(this['~workplaces'], [...this['~subsystems'], described]);
    }
}

/** Пустая оболочка, к которой добавляются подсистемы. */
export function shell(): ShellBuilder {
    return new ShellBuilder();
}

/**
 * Схема оболочки для одного пользователя: в ней остаются только объекты и страницы, для которых
 * `available` возвращает `true`. Это касается и рабочих мест. Группа без таких пунктов и подсистема без групп в результат
 * не попадают: пустой раздел показал бы пользователю, что от него что-то скрыто. По той же причине
 * не попадает и группа, которая пуста уже в конфигурации.
 */
export function restrictShell(builder: ShellBuilder<string>, available: (item: ShellItem) => boolean): ShellView {
    const subsystems = builder['~subsystems'].flatMap((subsystem): ReadonlyArray<ShellSubsystem> => {
        const groups = subsystem.groups.flatMap((group): ReadonlyArray<ShellGroup> => {
            const items = group.items.filter(available);
            return items.length === 0 ? [] : [{ ...group, items }];
        });
        return groups.length === 0 ? [] : [{ ...subsystem, groups }];
    });
    const workplaces = builder['~workplaces'].filter((name) => available({ kind: pageKind, name }));
    return { workplaces, subsystems };
}
