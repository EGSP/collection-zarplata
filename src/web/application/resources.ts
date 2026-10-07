/**
 * Ресурсы Refine из описаний объектов конфигурации.
 *
 * Ресурс связывает объект с адресом его страницы: по нему Refine определяет, с каким объектом
 * работает открытая страница, и строит меню. Ресурсы не объявляются в коде клиента, поэтому новый
 * объект конфигурации появляется в меню без изменений клиента.
 */
import type { ResourceProps } from '@refinedev/core';
import type { ObjectKind, ObjectView } from '../../server/ui/descriptions';
import { resourceName, type PerformTarget } from '../data-provider/perform';

/** Заголовки групп меню по видам объектов в порядке показа. */
const groupTitles: { readonly [Kind in ObjectKind]: string } = {
    catalog: 'Справочники',
    document: 'Документы',
    register: 'Регистры',
};

/** Адрес страницы объекта: `/catalog/sample`. */
export function objectPath(target: PerformTarget): string {
    return `/${target.kind}/${target.name}`;
}

/**
 * Ресурсы для `<Refine>`: по одному на объект в порядке ответа сервера. Объекты вложены
 * в ресурсы-группы по видам. У группы нет своей страницы, а группу без объектов меню не показывает.
 */
export function objectResources(objects: ReadonlyArray<ObjectView>): Array<ResourceProps> {
    return [
        ...Object.entries(groupTitles).map(([kind, title]) => ({ name: kind, meta: { label: title } })),
        ...objects.map((object) => ({
            name: resourceName(object),
            list: objectPath(object),
            meta: { label: object.title, parent: object.kind },
        })),
    ];
}
