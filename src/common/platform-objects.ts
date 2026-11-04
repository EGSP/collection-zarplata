/** Ссылка на встроенный справочник для конфигураций и компонентов. */
import type { ObjectReferenceOf } from './object-reference.js';
import type { Users } from '../server/users/object.js';
const usersReference = { kind: 'catalog', name: 'users' } as ObjectReferenceOf<typeof Users>;

/** Встроенные объекты доступны любой конфигурации через адрес и тип общего справочника. */
export const PlatformObjects = Object.freeze({ catalog: Object.freeze({ users: usersReference }) });
