import type { SchemaMigration } from './index.js';

const retiredRoles = "'accessAuditor', 'reader', 'sampleEditor', 'sampleDocumentReader'";

/** Снимает устаревшие назначения и настройки фиксированных ролей, сохраняя действующие назначения пользователей. */
export const fixedShopRoles: SchemaMigration = {
    id: '20261119_fixed_shop_roles',
    part: 'configuration',
    version: '1.4.0',
    changes: [],
    statements: [],
    prepare(previous) {
        // При создании базы служебных таблиц ещё нет, а начальные роли добавит новая конфигурация.
        const statements: string[] = [];
        if (previous.tables.some(table => table.name === 'platform_user_roles')) {
            statements.push(`DELETE FROM platform_user_roles WHERE role IN (${retiredRoles})`);
        }
        if (previous.tables.some(table => table.name === 'platform_access_settings')) {
            statements.push(`DELETE FROM platform_access_settings WHERE subjectKind = 'role' AND subject IN ('administrator', 'seller', 'manager', ${retiredRoles})`);
        }
        return { changes: [], statements };
    },
};
