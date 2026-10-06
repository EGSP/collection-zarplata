/**
 * Журнал действий: запись строки о каждом изменяющем действии и чтение журнала.
 *
 * Строку пишет диспетчер после выполнения действия, а не шаги, меняющие базу. Одно действие
 * может менять запись в нескольких местах: запись проведённого документа обновляет поля,
 * табличные части и признак проведения. Журнал сравнивает запись до действия с записью после
 * него, поэтому любое действие даёт одну строку со всеми изменениями, сколько бы запросов
 * к базе оно ни выполнило. Строка пишется через тот же дескриптор транзакции, что и данные:
 * откат действия удаляет и её.
 */
import { Effect } from 'effect';
import { newGuid } from '../common/guid.js';
import { Database } from '../database/database.effect.js';
import type { DatabaseError } from '../database/database.errors.js';
import { insert, select, type SqlCondition } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { ActionContext } from '../data/action-context.js';
import { DataNotFoundError, DataValidationError } from '../data/data.errors.js';
import { guidValue, objectValue, pageOptions, stringValue, type RecordValue } from '../data/records.js';

/** Служебная таблица журнала; её структуру описывает модуль схемы. */
const journalTable = 'platform_journal';

/**
 * Изменённые поля и табличные части: `{ "поле": { "before": …, "after": … } }`. Табличная часть
 * записывается целиком, списком строк до и после действия: строки не имеют собственного
 * идентификатора, и сопоставить отдельные строки до и после замены нельзя.
 */
export type JournalChanges = Record<string, { readonly before: unknown; readonly after: unknown }>;

/** Объект, над которым выполнено действие. `guid` пуст у собственного действия, которое не относится к одной записи. */
export interface JournalTarget {
    readonly kind: string;
    readonly name: string;
    readonly guid: string | null;
}

/** Строка журнала в ответе API: колонки таблицы, `changes` уже разобран из JSON. */
export interface JournalEntry {
    readonly guid: string;
    readonly occurredAt: string;
    readonly userGuid: string | null;
    readonly traceGuid: string;
    readonly actionGuid: string;
    readonly parentActionGuid: string | null;
    readonly targetKind: string;
    readonly targetName: string;
    readonly targetGuid: string | null;
    readonly action: string;
    readonly changes: JournalChanges | null;
}

/** Узел дерева цепочки: действие и вызванные им вложенные действия в порядке выполнения. */
export interface JournalTraceNode extends JournalEntry {
    readonly children: readonly JournalTraceNode[];
}

/** Строка таблицы до разбора `changes`. */
type JournalRow = Omit<JournalEntry, 'changes'> & { readonly changes: string | null };

/** Пустое значение поля или табличной части: такие значения у нового объекта в журнал не попадают. */
function isEmpty(value: unknown): boolean {
    return value === undefined || value === null || (Array.isArray(value) && value.length === 0);
}

/**
 * Сравнивает запись до и после действия по полям и табличным частям описания. Без записи «до»
 * объект считается новым, и в результат попадают все заполненные поля со значением «до», равным null.
 * `guid` не включается: он хранится в `targetGuid` и не меняется. Значения сравниваются через
 * JSON, поэтому строки табличных частей с одинаковым содержимым считаются равными.
 */
export function recordChanges(description: ObjectDescription, before: RecordValue | undefined, after: RecordValue): JournalChanges {
    const changes: JournalChanges = {};
    const names = [...description.fields.map((field) => field.name).filter((name) => name !== 'guid'), ...description.tableParts.map((part) => part.name)];
    for (const name of names) {
        const current = after[name] ?? null;
        if (before === undefined) {
            if (!isEmpty(current)) changes[name] = { before: null, after: current };
            continue;
        }
        const previous = before[name] ?? null;
        if (JSON.stringify(previous) !== JSON.stringify(current)) changes[name] = { before: previous, after: current };
    }
    return changes;
}

/**
 * Записывает одну строку журнала от имени текущего действия: пользователь, трасса и родитель
 * берутся из `ActionContext`. `occurredAt` — время начала действия: вложенные действия
 * завершаются и пишут свои строки раньше родителя, но по времени начала идут после него.
 * Вызывающий код должен выполнять запись внутри транзакции действия.
 */
export function writeJournal(entry: {
    readonly occurredAt: string;
    readonly target: JournalTarget;
    readonly action: string;
    readonly changes: JournalChanges | null;
}): Effect.Effect<void, DatabaseError, Database | ActionContext> {
    return Effect.gen(function* () {
        const database = yield* Database;
        const context = yield* ActionContext;
        yield* database.run(insert(journalTable, {
            guid: newGuid(),
            occurredAt: entry.occurredAt,
            userGuid: context.userGuid,
            traceGuid: context.traceGuid,
            actionGuid: context.actionGuid,
            parentActionGuid: context.parentActionGuid,
            targetKind: entry.target.kind,
            targetName: entry.target.name,
            targetGuid: entry.target.guid,
            action: entry.action,
            changes: entry.changes === null ? null : JSON.stringify(entry.changes),
        }));
    });
}

function entryFromRow(row: JournalRow): JournalEntry {
    return { ...row, changes: row.changes === null ? null : JSON.parse(row.changes) as JournalChanges };
}

/**
 * Страница строк по отбору, новые действия первыми. `rowid` различает действия, начатые в одну
 * миллисекунду: строки вставляются в порядке завершения действий.
 */
function page(where: readonly SqlCondition[], payload: RecordValue): Effect.Effect<unknown, DatabaseError, Database> {
    return Effect.gen(function* () {
        const { page, pageSize, offset } = pageOptions(payload);
        const database = yield* Database;
        const filtered = select(journalTable, { where });
        const count = yield* database.get<{ total: number }>({ sql: `SELECT COUNT(*) AS total FROM (${filtered.sql})`, parameters: filtered.parameters });
        const rows = yield* database.all<JournalRow>(select(journalTable, {
            where,
            orderBy: [{ column: 'occurredAt', direction: 'DESC' }, { column: 'rowid', direction: 'DESC' }],
            limit: pageSize,
            offset,
        }));
        return { items: rows.map(entryFromRow), total: count?.total ?? 0, page, pageSize };
    });
}

/**
 * История объекта: все действия над записью или, без `targetGuid`, над всеми записями объекта.
 * Неизвестный объект даёт 404, чтобы опечатка в имени не выглядела как пустая история.
 */
function history(payload: RecordValue): Effect.Effect<unknown, DatabaseError | DataNotFoundError, Database | Metadata> {
    return Effect.gen(function* () {
        const kind = stringValue(payload['targetKind'], 'payload.targetKind');
        const name = stringValue(payload['targetName'], 'payload.targetName');
        const metadata = yield* Metadata;
        if (metadata.find(kind as ObjectDescription['kind'], name) === undefined) {
            return yield* new DataNotFoundError({ message: `Объект ${kind}.${name} не найден` });
        }
        const where: SqlCondition[] = [{ column: 'targetKind', operator: '=', value: kind }, { column: 'targetName', operator: '=', value: name }];
        if (payload['targetGuid'] !== undefined) where.push({ column: 'targetGuid', operator: '=', value: guidValue(payload['targetGuid'], 'payload.targetGuid') });
        return yield* page(where, payload);
    });
}

/**
 * Цепочка одного запроса деревом: корни — внешние операции, дети — вложенные действия.
 * Действие, чей родитель не оставил строки, тоже становится корнем, чтобы не потеряться.
 * Порядок братьев совпадает с порядком выполнения.
 */
function trace(payload: RecordValue): Effect.Effect<unknown, DatabaseError, Database> {
    return Effect.gen(function* () {
        const traceGuid = guidValue(payload['traceGuid'], 'payload.traceGuid');
        const database = yield* Database;
        const rows = yield* database.all<JournalRow>(select(journalTable, {
            where: [{ column: 'traceGuid', operator: '=', value: traceGuid }],
            orderBy: [{ column: 'occurredAt', direction: 'ASC' }, { column: 'rowid', direction: 'ASC' }],
        }));
        const nodes = new Map(rows.map((row) => [row.actionGuid, { ...entryFromRow(row), children: [] as JournalTraceNode[] }]));
        const actions: JournalTraceNode[] = [];
        for (const node of nodes.values()) {
            const parent = node.parentActionGuid === null ? undefined : nodes.get(node.parentActionGuid);
            if (parent === undefined) actions.push(node);
            else parent.children.push(node);
        }
        return { traceGuid, actions };
    });
}

/**
 * Выполняет чтение журнала через единый эндпоинт: `history` — история объекта, `userActions` —
 * действия пользователя, `trace` — дерево цепочки по `traceGuid`. Чтение журнала само
 * в журнал не записывается. Неизвестное действие даёт 404, неверный payload — 400.
 */
export function readJournal(action: string, payload: unknown): Effect.Effect<unknown, DatabaseError | DataNotFoundError | DataValidationError, Database | Metadata> {
    return Effect.suspend(() => {
        const options = objectValue(payload, 'payload');
        switch (action) {
            case 'history': return history(options);
            case 'userActions': return page([{ column: 'userGuid', operator: '=', value: guidValue(options['userGuid'], 'payload.userGuid') }], options);
            case 'trace': return trace(options);
            default: return Effect.fail(new DataNotFoundError({ message: `Действие «${action}» для журнала не найдено` }));
        }
    });
}
