import { Effect } from 'effect';
import type { Database } from '../database/database.effect.js';
import type { SqlQuery } from '../database/sql.builder.js';
import { sqlIdentifier } from '../database/sql.builder.js';
import { migrations, type SchemaMigration } from './migrations/index.js';
import { createIndexSql, createTableSql, type ColumnStructure, type SchemaStructure } from './structure.js';

const query = (sql: string, parameters: SqlQuery['parameters'] = []): SqlQuery => ({ sql, parameters });

function destructiveChanges(previous: SchemaStructure, desired: SchemaStructure): string[] {
    const result: string[] = [];
    const desiredTables = new Map(desired.tables.map((table) => [table.name, table]));
    for (const oldTable of previous.tables) {
        const newTable = desiredTables.get(oldTable.name);
        if (newTable === undefined) {
            result.push(`${oldTable.name}: удалить таблицу`);
            continue;
        }
        const newColumns = new Map(newTable.columns.map((field) => [field.name, field]));
        for (const oldColumn of oldTable.columns) {
            const newColumn = newColumns.get(oldColumn.name);
            if (newColumn === undefined) result.push(`${oldTable.name}.${oldColumn.name}: удалить колонку`);
            else if (newColumn.type !== oldColumn.type) {
                result.push(`${oldTable.name}.${oldColumn.name}: сменить тип ${oldColumn.type} на ${newColumn.type}`);
            }
        }
        const newIndexes = new Map(newTable.indexes.map((index) => [index.name, index]));
        for (const oldIndex of oldTable.indexes) {
            const newIndex = newIndexes.get(oldIndex.name);
            if (newIndex === undefined || JSON.stringify(newIndex) !== JSON.stringify(oldIndex)) {
                result.push(`${oldTable.name}.${oldIndex.name}: изменить индекс`);
            }
        }
        if (JSON.stringify(oldTable.primaryKey) !== JSON.stringify(newTable.primaryKey)) {
            result.push(`${oldTable.name}: изменить первичный ключ`);
        }
    }
    return result;
}

function validateMigrations(available: readonly SchemaMigration[], pending: readonly SchemaMigration[], changes: readonly string[]): void {
    const ids = new Set<string>();
    let preceding = '';
    for (const migration of available) {
        if (!/^[0-9]{8}_[a-z][a-z0-9_]*$/.test(migration.id) || migration.id <= preceding || ids.has(migration.id)) {
            throw new Error(`Неверный идентификатор или порядок миграции «${migration.id}»`);
        }
        ids.add(migration.id);
        preceding = migration.id;
    }
    const covered = new Set(pending.flatMap((migration) => migration.changes));
    const missing = changes.filter((change) => !covered.has(change));
    if (missing.length > 0) {
        throw new Error(`Для изменений структуры нужна миграция в src/server/schema/migrations:\n${missing.map((change) => `- ${change}`).join('\n')}`);
    }
}

function addColumnSql(table: string, field: ColumnStructure): string {
    // Новая колонка допускает NULL, чтобы ALTER TABLE сохранила существующие строки.
    // Обязательность нового реквизита проверяется при записи; усиление ограничения требует миграции.
    return `ALTER TABLE ${sqlIdentifier(table)} ADD COLUMN ${sqlIdentifier(field.name)} ${field.type}`;
}

async function readSnapshot(database: Database): Promise<SchemaStructure | undefined> {
    const row = await Effect.runPromise(database.get<{ snapshot: string }>(query('SELECT snapshot FROM platform_schema WHERE id = 1')));
    if (row === undefined) return undefined;
    const parsed: unknown = JSON.parse(row.snapshot);
    if (typeof parsed !== 'object' || parsed === null || !('tables' in parsed) || !Array.isArray(parsed.tables)) {
        throw new Error('Снимок структуры базы данных повреждён');
    }
    return parsed as SchemaStructure;
}

async function readAppliedMigrations(database: Database): Promise<Set<string>> {
    const rows = await Effect.runPromise(database.all<{ id: string }>(query('SELECT id FROM platform_migrations')));
    return new Set(rows.map((row) => row.id));
}

/**
 * Создаёт служебные таблицы, затем сверяет метаданные со снимком и применяет изменения.
 * Миграции, новые элементы структуры и снимок записываются одной транзакцией;
 * ошибка в ней откатывает эти изменения и останавливает запуск.
 */
export async function synchronizeSchema(database: Database, desired: SchemaStructure, availableMigrations: readonly SchemaMigration[] = migrations): Promise<void> {
    const bootstrap = desired.tables.filter((table) => table.name === 'platform_schema' || table.name === 'platform_migrations');
    const existing = await Effect.runPromise(database.all<{ name: string }>(query("SELECT name FROM sqlite_master WHERE type = 'table'")));
    const existingNames = new Set(existing.map((row) => row.name.toLowerCase()));
    await Effect.runPromise(database.transaction(Effect.gen(function* () {
        for (const table of bootstrap) {
            if (!existingNames.has(table.name.toLowerCase())) yield* database.run(query(createTableSql(table)));
        }
    })));

    const stored = await readSnapshot(database);
    if (stored === undefined && existing.some((row) => !row.name.startsWith('sqlite_') && !bootstrap.some((table) => table.name.toLowerCase() === row.name.toLowerCase()))) {
        throw new Error('В базе есть таблицы без снимка структуры; перед запуском нужна отдельная миграция существующей базы');
    }
    const previous = stored ?? { tables: [] };
    const applied = await readAppliedMigrations(database);
    if (stored !== undefined && !existingNames.has('platform_migrations')) {
        throw new Error('Журнал миграций отсутствует при существующем снимке структуры');
    }
    const known = new Set(availableMigrations.map((migration) => migration.id));
    const unknown = [...applied].filter((id) => !known.has(id));
    if (unknown.length > 0) throw new Error(`В базе применены миграции, которых нет в сборке: ${unknown.join(', ')}`);
    const pending = availableMigrations.filter((migration) => !applied.has(migration.id));
    const changes = destructiveChanges(previous, desired);
    validateMigrations(availableMigrations, pending, changes);
    if (pending.some((migration) => [...applied].some((id) => id > migration.id))) {
        throw new Error('Миграции в базе применены не по порядку; добавьте новый файл после последней применённой миграции');
    }
    await Effect.runPromise(database.transaction(Effect.gen(function* () {
        for (const migration of pending) {
            for (const statement of migration.statements) yield* database.run(query(statement));
            yield* database.run(query('INSERT INTO platform_migrations (id, appliedAt) VALUES (?, ?)', [migration.id, new Date().toISOString()]));
        }
        const actualTables = yield* database.all<{ name: string }>(query("SELECT name FROM sqlite_master WHERE type = 'table'"));
        const actualNames = new Set(actualTables.map((row) => row.name.toLowerCase()));
        for (const table of desired.tables) {
            if (!actualNames.has(table.name.toLowerCase())) yield* database.run(query(createTableSql(table)));
            else {
                const columns = yield* database.all<{ name: string; type: string; pk: number }>(query(`PRAGMA table_info(${sqlIdentifier(table.name)})`));
                const current = new Map(columns.map((field) => [field.name, field]));
                for (const field of table.columns) {
                    const present = current.get(field.name);
                    if (present === undefined) yield* database.run(query(addColumnSql(table.name, field)));
                    else if (present.type.toUpperCase() !== field.type) {
                        throw new Error(`После миграции тип колонки ${table.name}.${field.name} не совпадает с метаданными`);
                    }
                }
                const expected = new Set(table.columns.map((field) => field.name));
                for (const field of columns) {
                    if (!expected.has(field.name)) throw new Error(`После миграции осталась лишняя колонка ${table.name}.${field.name}`);
                }
                const actualKey = columns.filter((field) => field.pk > 0).sort((left, right) => left.pk - right.pk).map((field) => field.name);
                if (JSON.stringify(actualKey) !== JSON.stringify(table.primaryKey)) {
                    throw new Error(`После миграции первичный ключ таблицы ${table.name} не совпадает с метаданными`);
                }
                const tableDefinition = yield* database.get<{ sql: string }>(query("SELECT sql FROM sqlite_master WHERE type = 'table' AND lower(name) = lower(?)", [table.name]));
                if (!tableDefinition?.sql.trim().toUpperCase().endsWith('STRICT')) {
                    throw new Error(`Таблица ${table.name} должна быть создана в режиме STRICT`);
                }
            }
            for (const definition of table.indexes) {
                const expectedSql = createIndexSql(table.name, definition);
                // Turso возвращает имена sqlite_master в нижнем регистре даже для имён в кавычках.
                const index = yield* database.get<{ sql: string }>(query("SELECT sql FROM sqlite_master WHERE type = 'index' AND lower(name) = lower(?)", [definition.name]));
                if (index === undefined) yield* database.run(query(expectedSql));
                else if (index.sql !== expectedSql) throw new Error(`После миграции индекс ${definition.name} не совпадает с метаданными`);
            }
        }
        for (const oldTable of previous.tables) {
            if (!desired.tables.some((table) => table.name === oldTable.name) && actualNames.has(oldTable.name.toLowerCase())) {
                throw new Error(`После миграции осталась лишняя таблица ${oldTable.name}`);
            }
        }
        yield* database.run(query('INSERT INTO platform_schema (id, snapshot) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET snapshot = excluded.snapshot', [JSON.stringify(desired)]));
    })));
}
