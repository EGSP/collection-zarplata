/**
 * Ресурсы Refine из описаний объектов конфигурации.
 *
 * Ресурс связывает объект с адресом его страницы: по нему Refine определяет, с каким объектом
 * работает открытая страница. Ресурсы не объявляются в коде клиента, поэтому страницы нового
 * объекта конфигурации работают без изменений клиента.
 *
 * Меню из ресурсов не строится: его состав задаёт схема оболочки, в которой один объект может
 * стоять в нескольких группах. Поэтому ресурсы плоские, без ресурсов-групп.
 */
import type { ResourceProps } from '@refinedev/core';
import type { ObjectView } from '../../server/ui/descriptions';
import { newRecordPath, objectPath, recordPath } from '../common/paths';
import { resourceName } from '../data-provider/perform';

/**
 * Ресурсы для `<Refine>`: по одному на объект в порядке ответа сервера. Адреса форм объявлены
 * у объектов, у которых форма есть: по ним Refine относит страницу формы к объекту.
 */
export function objectResources(objects: ReadonlyArray<ObjectView>): Array<ResourceProps> {
    return objects.map((object) => ({
        name: resourceName(object),
        list: objectPath(object),
        ...(object.form === null ? {} : { create: newRecordPath(object), edit: recordPath(object, ':id') }),
        meta: { label: object.title },
    }));
}
