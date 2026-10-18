import { page } from '../../server/ui/pages.js';

/** Просмотр дерева RBAC. Его данные отдельно защищает право платформы authorization.read. */
export const AccessRights = page('accessRights').title('Права доступа');
