import type { SchemaMigration } from './index.js';

const changes = ['platform_users: удалить таблицу', 'platform_user_roles: удалить таблицу'];

/** Переносит справочник пользователей и HMAC в штатные таблицы, сохраняя UUID всех ссылок. */
export const userCatalogStorage: SchemaMigration = {
    id: '20261119_user_catalog_storage',
    part: 'platform',
    version: '1.2.0',
    changes,
    statements: [],
    prepare(previous) {
        // Новая база получит таблицы из метаданных. В старой представления могут отсутствовать,
        // если база создана версией до их появления или запуск прервался после синхронизации.
        if (!previous.tables.some(table => table.name === 'platform_users' || table.name === 'platform_user_roles')) {
            return { changes: [], statements: [] };
        }
        return {
            changes,
            statements: [
                'DROP VIEW IF EXISTS catalog_users_roles',
                'DROP VIEW IF EXISTS catalog_users',
                'CREATE TABLE catalog_users (guid TEXT NOT NULL, deletedAt TEXT, name TEXT NOT NULL, disabledAt TEXT, PRIMARY KEY (guid)) STRICT',
                'CREATE TABLE catalog_users_roles (ownerGuid TEXT NOT NULL, lineNumber INTEGER NOT NULL, role TEXT NOT NULL, PRIMARY KEY (ownerGuid, lineNumber)) STRICT',
                'CREATE TABLE platform_user_credentials (userGuid TEXT NOT NULL, pinHash TEXT NOT NULL, PRIMARY KEY (userGuid)) STRICT',
                'INSERT INTO catalog_users (guid, name, disabledAt) SELECT guid, name, disabledAt FROM platform_users',
                'INSERT INTO catalog_users_roles (ownerGuid, lineNumber, role) SELECT userGuid, ROW_NUMBER() OVER (PARTITION BY userGuid ORDER BY role), role FROM platform_user_roles',
                'INSERT INTO platform_user_credentials (userGuid, pinHash) SELECT guid, pinHash FROM platform_users',
                // Сессии, токены и журнал уже ссылаются на UUID пользователя. Переписывать ссылки не требуется.
                'DROP TABLE platform_user_roles',
                'DROP TABLE platform_users',
            ],
        };
    },
};
