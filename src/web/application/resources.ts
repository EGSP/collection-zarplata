/**
 * Ресурсы Refine из описаний объектов конфигурации.
 *
 * Ресурс связывает объект с адресом его страницы: по нему Refine определяет, с каким объектом
 * работает открытая страница, и строит меню. Ресурсы не объявляются в коде клиента, поэтому новый
 * объект конфигурации появляется в меню без изменений клиента.
 */
import type { ResourceProps } from '@refinedev/core';
import type { ObjectKind, ObjectView } from '../../server/ui/descriptions';
import { newRecordPath, objectPath, recordPath } from '../common/paths';
import { resourceName } from '../data-provider/perform';

/** Заголовки групп меню по видам объектов в порядке показа. */
const groupTitles: { readonly [Kind in ObjectKind]: string } = {
    catalog: 'Справочники',
    document: 'Документы',
    register: 'Регистры',
};

/**
 * Ресурсы для `<Refine>`: по одному на объект в порядке ответа сервера. Объекты вложены
 * в ресурсы-группы по видам. У группы нет своей страницы, а группу без объектов меню не показывает.
 * Адреса форм объявлены у объектов, у которых форма есть: по ним Refine относит страницу формы
 * к объекту, и пункт меню остаётся выделенным.
 */
export function objectResources(objects: ReadonlyArray<ObjectView>): Array<ResourceProps> {
    return [
        ...Object.entries(groupTitles).map(([kind, title]) => ({ name: kind, meta: { label: title } })),
        ...objects.map((object) => ({
            name: resourceName(object),
            list: objectPath(object),
            ...(object.form === null ? {} : { create: newRecordPath(object), edit: recordPath(object, ':id') }),
            meta: { label: object.title, parent: object.kind },
        })),
    ];
}
