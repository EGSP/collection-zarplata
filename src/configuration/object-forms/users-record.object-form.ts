/** Форма встроенного справочника пользователей подключена как форма конфигурации. */
import type { ObjectReferenceOf } from '../../common/object-reference.js';
import { defineObjectForm } from '../../server/metadata/object-forms.js';
import type { Users } from '../../server/users/object.js';
export const usersRecordForm = defineObjectForm({ object: { kind: 'catalog', name: 'users' } as ObjectReferenceOf<typeof Users>, kind: 'record' });
