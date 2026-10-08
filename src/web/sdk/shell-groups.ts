/**
 * Описание именованных мест клиента. Дерево составляется до отрисовки и не зависит
 * от порядка монтирования вкладок. Сервер эти объявления не получает.
 */
import type { ComponentType } from 'react';
import type { PerformTarget } from '../data-provider/perform';

/** Именованный контейнер с направлением раскладки. */
export interface ShellGroup {
    readonly name: string;
    readonly orientation: 'vertical' | 'horizontal';
}

/** Компонент группы. Требуемые объекты проверяются до монтирования и чтения данных. */
export interface ShellGroupComponent {
    readonly component: ComponentType;
    readonly requiredObjects?: ReadonlyArray<PerformTarget>;
}

/** Добавление компонента либо вложенной группы в родительскую группу. Порядок массива задаёт порядок показа. */
export interface ShellGroupEntry {
    readonly parent: ShellGroup;
    readonly content: ShellGroup | ShellGroupComponent;
}

/** Объявляет группу. Вложенность задаётся отдельной записью в составе конфигурации. */
export function shellGroup(name: string, orientation: ShellGroup['orientation'] = 'vertical'): ShellGroup {
    return Object.freeze({ name, orientation });
}

const listGroups = new Map<string, ShellGroup>();

/** Группы платформы: главный экран и отдельное место над списком каждого объекта. */
export const ShellGroups = {
    home: shellGroup('home'),
    /** Возвращает стабильное объявление группы списка по виду и имени объекта. */
    list(object: PerformTarget): ShellGroup {
        const name = `list/${object.kind}/${object.name}`;
        const group = listGroups.get(name) ?? shellGroup(name);
        listGroups.set(name, group);
        return group;
    },
};

/**
 * Проверяет дерево и сохраняет порядок добавления. Имена групп уникальны, ориентация
 * всех ссылок на одно имя одинакова; циклы и несколько родителей запрещены.
 * Компонент можно добавлять несколько раз, в том числе в разные группы.
 */
export function defineShellGroups(entries: ReadonlyArray<ShellGroupEntry>): ReadonlyArray<ShellGroupEntry> {
    const groups = new Map<string, ShellGroup>();
    const parents = new Map<string, string>();
    const remember = (group: ShellGroup) => {
        const known = groups.get(group.name);
        if (group.name.length === 0 || (known !== undefined && known.orientation !== group.orientation)) {
            throw new Error(`Группа «${group.name}» должна иметь непустое имя и одну ориентацию`);
        }
        groups.set(group.name, group);
    };
    for (const entry of entries) {
        remember(entry.parent);
        if ('component' in entry.content) continue;
        remember(entry.content);
        if (parents.has(entry.content.name)) throw new Error(`У группы «${entry.content.name}» уже есть родитель`);
        parents.set(entry.content.name, entry.parent.name);
    }
    for (const name of parents.keys()) {
        const visited = new Set<string>();
        let current: string | undefined = name;
        while (current !== undefined) {
            if (visited.has(current)) throw new Error(`Группа «${name}» образует цикл вложенности`);
            visited.add(current);
            current = parents.get(current);
        }
    }
    return entries.map((entry) => Object.freeze({ ...entry }));
}
