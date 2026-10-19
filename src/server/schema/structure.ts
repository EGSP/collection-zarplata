import type { FieldDescription, ObjectDescription } from '../metadata/descriptions.js';
import { sqlIdentifier } from '../database/sql.builder.js';
import { fieldStorage, tablePartStorageFields } from '../database/field-storage.js';

/** Физический тип колонки SQLite в таблице STRICT. */
export type ColumnType = 'TEXT' | 'INTEGER' | 'REAL';

/** Колонка снимка структуры; обязательность новых реквизитов проверяет слой записи. */
export interface ColumnStructure {
    readonly name: string;
    readonly type: ColumnType;
    readonly required: boolean;
}

/** Индекс с устойчивым именем и порядком колонок. */
export interface IndexStructure {
    readonly name: string;
    readonly columns: readonly string[];
    readonly unique: boolean;
}

/** Таблица, которую платформа создаёт из метаданных или собственного описания. */
export interface TableStructure {
    readonly name: string;
    readonly columns: readonly ColumnStructure[];
    readonly primaryKey: readonly string[];
    readonly indexes: readonly IndexStructure[];
}

/** Снимок желаемой структуры без данных и версий миграций. */
export interface SchemaStructure {
    readonly tables: readonly TableStructure[];
}

const column = (name: string, type: ColumnType, required = false): ColumnStructure => ({ name, type, required });
const index = (table: string, name: string, columns: readonly string[], unique = false): IndexStructure => ({
    name: `idx_${table}_${name}`, columns, unique,
});

/**
 * Поле хранит ссылку: обычную, полную либо ссылочным вариантом составного поля. По таким полям
 * ищут записи, которые ссылаются на объект, поэтому они индексируются.
 */
function storesReference(field: FieldDescription): boolean {
    return field.kind === 'reference' || field.kind === 'objectReference' || (field.variants ?? []).some((variant) => variant.kind === 'reference');
}

/** Индекс поля по столбцам сравнения: у составного поля первым идёт тип варианта. */
function fieldIndex(table: string, field: FieldDescription): IndexStructure {
    return index(table, field.name, fieldStorage(field).orderColumns);
}

function objectTable(object: ObjectDescription): TableStructure {
    const name = `${object.kind}_${object.name}`;
    const columns = object.fields.flatMap((field) => fieldStorage(field).columns);
    const keyFields = object.kind === 'register' ? ['recorder', 'lineNumber']
        : object.kind === 'informationRegister' ? object.fields.filter((field) => field.role === 'dimension').map((field) => field.name) : ['guid'];
    const primaryKey = keyFields.flatMap((name) => fieldStorage(object.fields.find((field) => field.name === name)!).keyColumns);
    const indexes: IndexStructure[] = [];
    if (object.kind === 'catalog' || object.kind === 'document') {
        indexes.push(index(name, 'deletedAt', ['deletedAt']));
        if (object.kind === 'document') indexes.push(index(name, 'number', ['number']));
    } else if (object.kind === 'register') {
        indexes.push(index(name, 'period', ['period']));
    }
    for (const field of object.fields) {
        if (storesReference(field) || field.role === 'dimension') indexes.push(fieldIndex(name, field));
    }
    return { name, columns, primaryKey, indexes };
}

function tableParts(object: ObjectDescription): readonly TableStructure[] {
    return object.tableParts.map((part) => {
        const name = `${object.kind}_${object.name}_${part.name}`;
        return {
            name,
            columns: [...tablePartStorageFields, ...part.fields].flatMap((field) => fieldStorage(field).columns),
            primaryKey: ['ownerGuid', 'lineNumber'],
            indexes: part.fields.filter(storesReference).map((field) => fieldIndex(name, field)),
        };
    });
}

const platformTables: readonly TableStructure[] = [
    // Одна строка с расписанием и границей его действия; вместе с данными попадает в резервную копию.
    { name: 'platform_backup_settings', columns: [column('id', 'INTEGER', true), column('schedule', 'TEXT', true), column('keep', 'INTEGER', true), column('updatedAt', 'TEXT', true)], primaryKey: ['id'], indexes: [] },
    { name: 'platform_schema', columns: [column('id', 'INTEGER', true), column('snapshot', 'TEXT', true)], primaryKey: ['id'], indexes: [] },
    { name: 'platform_migrations', columns: [column('id', 'TEXT', true), column('appliedAt', 'TEXT', true)], primaryKey: ['id'], indexes: [] },
    {
        name: 'platform_journal',
        columns: [
            column('guid', 'TEXT', true), column('occurredAt', 'TEXT', true),
            column('userGuid', 'TEXT'), column('traceGuid', 'TEXT', true), column('actionGuid', 'TEXT', true), column('parentActionGuid', 'TEXT'),
            column('targetKind', 'TEXT', true), column('targetName', 'TEXT', true), column('targetGuid', 'TEXT'),
            column('targetKey', 'TEXT'),
            column('action', 'TEXT', true), column('changes', 'TEXT'),
        ],
        primaryKey: ['guid'],
        // Индексы соответствуют трём способам чтения журнала: история объекта, действия пользователя и цепочка запроса.
        indexes: [
            index('platform_journal', 'occurredAt', ['occurredAt']),
            index('platform_journal', 'target', ['targetKind', 'targetName', 'targetGuid']),
            index('platform_journal', 'userGuid', ['userGuid']),
            index('platform_journal', 'traceGuid', ['traceGuid']),
        ],
    },
    { name: 'platform_users', columns: [column('guid', 'TEXT', true), column('name', 'TEXT', true), column('pinHash', 'TEXT', true), column('disabledAt', 'TEXT')], primaryKey: ['guid'], indexes: [index('platform_users', 'pinHash', ['pinHash'], true)] },
    // Первичный ключ начинается с пользователя и покрывает единственный способ чтения: роли одного пользователя.
    { name: 'platform_user_roles', columns: [column('userGuid', 'TEXT', true), column('role', 'TEXT', true)], primaryKey: ['userGuid', 'role'], indexes: [] },
    { name: 'platform_tokens',columns: [column('guid', 'TEXT', true), column('userGuid', 'TEXT', true), column('expiresAt', 'TEXT', true), column('revokedAt', 'TEXT')], primaryKey: ['guid'], indexes: [index('platform_tokens', 'userGuid', ['userGuid'])] },
];

/** Строит все прикладные и служебные таблицы в устойчивом порядке; имена проверяются при построении SQL. */
export function describeSchema(objects: readonly ObjectDescription[]): SchemaStructure {
    const tables = [...platformTables, ...objects.flatMap((object) => [objectTable(object), ...tableParts(object)])];
    const names = new Set<string>();
    for (const table of tables) {
        sqlIdentifier(table.name);
        if (names.has(table.name)) throw new Error(`Повторяется имя таблицы «${table.name}»`);
        names.add(table.name);
        for (const field of table.columns) sqlIdentifier(field.name);
    }
    return { tables: tables.sort((left, right) => left.name.localeCompare(right.name)) };
}

/** SQL создания таблицы STRICT; первичный ключ задаётся явно и сохраняет порядок колонок. */
export function createTableSql(table: TableStructure): string {
    const fields = table.columns.map((field) => `${sqlIdentifier(field.name)} ${field.type}${field.required ? ' NOT NULL' : ''}`);
    fields.push(`PRIMARY KEY (${table.primaryKey.map(sqlIdentifier).join(', ')})`);
    return `CREATE TABLE ${sqlIdentifier(table.name)} (${fields.join(', ')}) STRICT`;
}

/** SQL создания индекса из проверенных имён; значения данных здесь не используются. */
export function createIndexSql(table: string, definition: IndexStructure): string {
    return `CREATE ${definition.unique ? 'UNIQUE ' : ''}INDEX ${sqlIdentifier(definition.name)} ON ${sqlIdentifier(table)} (${definition.columns.map(sqlIdentifier).join(', ')})`;
}
