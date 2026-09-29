import type { FieldDescription, ObjectDescription } from '../metadata/descriptions.js';
import { sqlIdentifier } from '../database/sql.builder.js';

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

function fieldColumns(field: FieldDescription): readonly ColumnStructure[] {
    if (field.kind === 'recorder') {
        return [column('recorderDocument', 'TEXT', true), column('recorderGuid', 'TEXT', true)];
    }
    const type: ColumnType = field.kind === 'number'
        ? (field.integer ? 'INTEGER' : 'REAL')
        : field.kind === 'money' || field.kind === 'boolean' ? 'INTEGER' : 'TEXT';
    return [column(field.name, type, field.required)];
}

function objectTable(object: ObjectDescription): TableStructure {
    const name = `${object.kind}_${object.name}`;
    const columns = object.fields.flatMap(fieldColumns);
    const primaryKey = object.kind === 'register' ? ['recorderDocument', 'recorderGuid', 'lineNumber'] : ['guid'];
    const indexes: IndexStructure[] = [];
    if (object.kind !== 'register') {
        indexes.push(index(name, 'deletedAt', ['deletedAt']));
        indexes.push(index(name, object.kind === 'catalog' ? 'code' : 'number', [object.kind === 'catalog' ? 'code' : 'number']));
    } else {
        indexes.push(index(name, 'period', ['period']));
    }
    for (const field of object.fields) {
        if (field.kind === 'reference') indexes.push(index(name, field.name, [field.name]));
        if (field.role === 'dimension' && field.kind !== 'reference') indexes.push(index(name, field.name, [field.name]));
    }
    return { name, columns, primaryKey, indexes };
}

function tableParts(object: ObjectDescription): readonly TableStructure[] {
    return object.tableParts.map((part) => {
        const name = `${object.kind}_${object.name}_${part.name}`;
        return {
            name,
            columns: [column('ownerGuid', 'TEXT', true), column('lineNumber', 'INTEGER', true), ...part.fields.flatMap(fieldColumns)],
            primaryKey: ['ownerGuid', 'lineNumber'],
            indexes: part.fields.filter((field) => field.kind === 'reference').map((field) => index(name, field.name, [field.name])),
        };
    });
}

const platformTables: readonly TableStructure[] = [
    { name: 'platform_schema', columns: [column('id', 'INTEGER', true), column('snapshot', 'TEXT', true)], primaryKey: ['id'], indexes: [] },
    { name: 'platform_migrations', columns: [column('id', 'TEXT', true), column('appliedAt', 'TEXT', true)], primaryKey: ['id'], indexes: [] },
    { name: 'platform_journal', columns: [column('guid', 'TEXT', true), column('occurredAt', 'TEXT', true), column('actorGuid', 'TEXT'), column('action', 'TEXT', true), column('objectKind', 'TEXT'), column('objectName', 'TEXT'), column('objectGuid', 'TEXT'), column('details', 'TEXT')], primaryKey: ['guid'], indexes: [index('platform_journal', 'occurredAt', ['occurredAt']), index('platform_journal', 'object', ['objectKind', 'objectName', 'objectGuid'])] },
    { name: 'platform_users', columns: [column('guid', 'TEXT', true), column('name', 'TEXT', true), column('pinHash', 'TEXT', true), column('disabledAt', 'TEXT')], primaryKey: ['guid'], indexes: [index('platform_users', 'pinHash', ['pinHash'], true)] },
    { name: 'platform_tokens', columns: [column('guid', 'TEXT', true), column('userGuid', 'TEXT', true), column('expiresAt', 'TEXT', true), column('revokedAt', 'TEXT')], primaryKey: ['guid'], indexes: [index('platform_tokens', 'userGuid', ['userGuid'])] },
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
