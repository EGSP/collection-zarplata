import { page } from '../../server/ui/pages.js';

/** Служебный справочник учётных записей: право страницы не заменяет права чтения и записи. */
export const Users = page('users').title('Пользователи');
