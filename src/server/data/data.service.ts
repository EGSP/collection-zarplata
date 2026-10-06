import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { newGuid } from '../common/guid.js';
import { DatabaseService } from '../database/database.service.js';
import { Database } from '../database/database.effect.js';
import { insert, remove, select, sqlIdentifier, update, type SqlCondition, type SqlFilter, type SqlOrder, type SqlValue } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { actionInputSchema, fieldSchema, inputSchema } from '../metadata/schema.js';
import { readJournal, recordChanges, writeJournal } from '../journal/journal.js';
import { filterOperators, type FilterOperator } from '../ui/descriptions.js';
import { ActionContext, ActionDispatcher } from './action-context.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { afterSave, markDeleted, post, unpost } from './posting.js';
import { guidValue, loadRecord, objectValue, pageOptions, recordFromRow, sqlValue, stringValue, tableName, validated, type RecordValue } from './records.js';
import { readOnlyDatabase } from './read-only-database.js';
import { enforcePolicies, type PolicyInvocation } from './policies.js';

/** Сервисы, которые получают из окружения Effect стандартные действия и обработчики конфигурации. */
type ActionRequirements = Database | Metadata | ActionContext | ActionDispatcher;
/** Подготовленное действие: аргументы политики и запись, которую можно выполнить после проверки. */
type PreparedMutation = {
    readonly policy: PolicyInvocation;
    readonly apply: Effect.Effect<RecordValue, unknown, ActionRequirements>;
};
/** Внешний запрос после проверки обязательных полей оболочки; payload проверяется для выбранного действия. */
type Operation = { readonly target: { readonly kind: string; readonly name: string }; readonly action: string; readonly payload: unknown };
/**
 * Условие отбора, которое проверяется после чтения строки, а не в SQL: буквальная подстрока,
 * которую `LIKE` в Turso понимает как шаблон и сравнивает с учётом регистра кириллицы.
 */
type RowPredicate = (row: RecordValue) => boolean;

/** Ширина номера документа: номера одной длины сортируются как строки в числовом порядке. */
const numberWidth = 6;

/**
 * Операторы SQL для способов сравнения из формата описаний. `contains` в SQL не переводится:
 * `LIKE` в Turso считает `%` и `_` шаблоном и не складывает регистр кириллицы.
 */
const sqlOperators: { readonly [Operator in Exclude<FilterOperator, 'contains'>]: SqlCondition['operator'] } = {
    equals: '=',
    notEquals: '!=',
    greater: '>',
    greaterOrEqual: '>=',
    less: '<',
    lessOrEqual: '<=',
};

/** Приводит строку и запрос к одному регистру, сохраняя буквальный смысл символов `%` и `_`. */
function searchText(value: string): string {
    return value.normalize('NFC').toLowerCase();
}

/** Проверяет оболочку операции, оставляя проверку payload схеме конкретного действия. */
function parseOperation(value: unknown): Operation {
    const operation = objectValue(value, 'операция');
    const target = objectValue(operation['target'], 'target');
    return {
        target: { kind: stringValue(target['kind'], 'target.kind'), name: stringValue(target['name'], 'target.name') },
        action: stringValue(operation['action'], 'action'),
        payload: operation['payload'] ?? {},
    };
}

/** Цель операции чтения журнала. Вид `platform` не совпадает ни с одним видом объектов конфигурации. */
const journalTarget = { kind: 'platform', name: 'journal' } as const;

/**
 * Диспетчер выполняет операции в одной транзакции и предоставляет собственным обработчикам
 * контекст и повторный вход через Effect. Каждое изменяющее действие, в том числе вложенное,
 * записывает строку журнала в той же транзакции. Права добавит отдельная задача.
 */
@Injectable()
export class DataService {
    constructor(private readonly metadata: MetadataService, private readonly database: DatabaseService) {}

    /**
     * Принимает одну операцию или непустой пакет. Вся цепочка использует одну транзакцию;
     * при ошибке любой операции откатываются предшествующие записи. Возвращает один результат
     * либо массив в порядке операций; типизированные ошибки переводит фильтр контроллера.
     */
    perform(body: unknown, userGuid: string): Promise<unknown> {
        if (Array.isArray(body) && body.length === 0) {
            return Promise.reject(new DataValidationError({ message: 'Пакет операций пуст', fields: ['операции'] }));
        }
        const operations = Array.isArray(body) ? body : [body];
        // Тот же диспетчер доступен обработчикам: вложенный вызов не обходит проверку и транзакцию.
        // Контракт диспетчера не требует от обработчика базы и метаданных, поэтому они передаются здесь.
        const dispatcher: ActionDispatcher = { execute: (operation) => this.provideServices(this.execute(operation)) };
        const program = Effect.forEach(operations, (operation) => this.execute(operation, userGuid)).pipe(
            (work) => this.database.effect.transaction(work),
            Effect.provideService(ActionDispatcher, dispatcher),
            (work) => this.provideServices(work),
            Effect.map((results) => Array.isArray(body) ? results : results[0]),
        );
        return Effect.runPromise(program);
    }

    /** Передаёт в окружение Effect сервисы Nest, которые нужны действиям: базу и метаданные. */
    private provideServices<Value, Error, Requirements>(
        work: Effect.Effect<Value, Error, Requirements>,
    ): Effect.Effect<Value, Error, Exclude<Exclude<Requirements, Database>, Metadata>> {
        return work.pipe(Effect.provideService(Database, this.database.effect), Effect.provideService(Metadata, this.metadata));
    }

    /** Находит цель и даёт каждому действию свой контекст, наследуя трассу и пользователя у вложенного. */
    private execute(value: unknown, userGuid: string | null = null): Effect.Effect<unknown, unknown, Exclude<ActionRequirements, ActionContext>> {
        return Effect.gen(function* (this: DataService) {
            const operation = parseOperation(value);
            if (operation.target.kind === journalTarget.kind && operation.target.name === journalTarget.name) {
                return yield* readJournal(operation.action, operation.payload);
            }
            const description = this.metadata.find(operation.target.kind as ObjectDescription['kind'], operation.target.name);
            if (description === undefined) {
                return yield* new DataNotFoundError({ message: `Объект ${operation.target.kind}.${operation.target.name} не найден` });
            }
            // У внешней операции родителя нет; вложенная получает текущий контекст из Effect.
            const parent = yield* Effect.serviceOption(ActionContext);
            const context: ActionContext = {
                userGuid: parent._tag === 'Some' ? parent.value.userGuid : userGuid,
                traceGuid: parent._tag === 'Some' ? parent.value.traceGuid : newGuid(),
                actionGuid: newGuid(),
                parentActionGuid: parent._tag === 'Some' ? parent.value.actionGuid : null,
            };
            return yield* Effect.provideService(this.dispatch(description, operation.action, operation.payload), ActionContext, context);
        }.bind(this));
    }

    /** Выбирает стандартное или собственное действие; неизвестное действие возвращает 404. */
    private dispatch(description: ObjectDescription, action: string, payload: unknown): Effect.Effect<unknown, unknown, ActionRequirements> {
        if (description.kind !== 'register') {
            switch (action) {
                case 'list': return this.list(description, payload);
                case 'get': return this.get(description, payload);
                case 'save': return Effect.suspend(() => {
                    const guid = objectValue(payload, 'payload')['guid'] === undefined ? undefined : this.guidPayload(payload);
                    return this.executeMutation(description, action, guid, (before) => this.prepareSave(description, payload, before));
                });
                case 'markDeleted':
                case 'unmarkDeleted': return Effect.suspend(() => {
                    const guid = this.guidPayload(payload);
                    const marked = action === 'markDeleted';
                    return this.executeMutation(description, action, guid, (before) => Effect.succeed({
                        policy: { action: marked ? 'markDeleted' : 'unmarkDeleted', input: { record: before! } },
                        apply: markDeleted(description, guid, marked),
                    }));
                });
            }
        }
        if (description.kind === 'document') {
            switch (action) {
                case 'post':
                case 'unpost': return Effect.suspend(() => {
                    const guid = this.guidPayload(payload);
                    return this.executeMutation(description, action, guid, (before) => Effect.succeed({
                        policy: { action: action === 'post' ? 'post' : 'unpost', input: { document: before! } },
                        apply: (action === 'post' ? post : unpost)(description, guid),
                    }));
                });
            }
        }
        if (description.kind === 'register') {
            if (action === 'list') return this.list(description, payload);
            // Движения должны соответствовать проведённым документам, поэтому записывает их только проведение.
            if (['get', 'save', 'markDeleted', 'unmarkDeleted', 'post', 'unpost'].includes(action)) {
                return Effect.fail(new DataNotFoundError({
                    message: `Действие «${action}» для регистра недоступно: строки регистра записывают документы при проведении`,
                }));
            }
        }
        const custom = description.actions.find((candidate) => candidate.name === action);
        if (custom !== undefined && custom.handler !== null) {
            return Effect.gen(function* (this: DataService) {
                const occurredAt = new Date().toISOString();
                const schema = actionInputSchema(description, action)!;
                const input = yield* validated(schema, payload, 'payload');
                // Описания хранят обработчики с разными типами аргументов; вызов допустим после проверки по его схеме.
                const result = custom.handler!(input as never);
                if (!Effect.isEffect(result)) return yield* Effect.die(new Error('Обработчик действия должен вернуть Effect'));
                const value = yield* Effect.provideService(result as Effect.Effect<unknown, unknown, ActionRequirements>, Database, readOnlyDatabase(this.database.effect));
                // Платформа не знает, что именно изменил обработчик: изменения записей попадают в журнал
                // строками вложенных действий, а эта строка связывает их с вызовом через parentActionGuid.
                yield* writeJournal({ occurredAt, target: { kind: description.kind, name: description.name, guid: null }, action, changes: null });
                return value;
            }.bind(this));
        }
        return Effect.fail(new DataNotFoundError({ message: `Действие «${action}» для ${description.kind}.${description.name} не найдено` }));
    }

    /** Проверяет идентификатор в действиях чтения и пометки до запроса к базе. */
    private guidPayload(payload: unknown): string {
        return guidValue(objectValue(payload, 'payload')['guid'], 'payload.guid');
    }

    /**
     * Выполняет общий конвейер изменения: читает запись, готовит действие, вызывает его политики,
     * применяет действие и пишет одну строку журнала. Подготовка не изменяет базу. Любая ошибка
     * прерывает конвейер и откатывает транзакцию запроса вместе с вложенными действиями.
     */
    private executeMutation(
        description: ObjectDescription,
        action: string,
        guid: string | undefined,
        prepare: (before: RecordValue | undefined) => Effect.Effect<PreparedMutation, unknown, ActionRequirements>,
    ): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.gen(function* () {
            const occurredAt = new Date().toISOString();
            const before = guid === undefined ? undefined : yield* loadRecord(description, guid);
            const prepared = yield* prepare(before);
            yield* enforcePolicies(description, prepared.policy);
            const after = yield* prepared.apply;
            yield* writeJournal({
                occurredAt,
                target: { kind: description.kind, name: description.name, guid: after['guid'] as string },
                action,
                changes: recordChanges(description, before, after),
            });
            return after;
        });
    }

    /** Читает одну запись вместе со всеми табличными частями; отсутствующая запись даёт 404. */
    private get(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, Database> {
        return Effect.suspend(() => loadRecord(description, this.guidPayload(payload)));
    }

    /**
     * Выбирает страницу и общее число строк по одному отбору. Поля сверяются с метаданными,
     * поэтому их имена могут безопасно участвовать в построении SQL; значения остаются параметрами.
     * Условия, которые нельзя выразить в SQL, проверяет на кандидатах порциями до подсчёта
     * и разбиения на страницы. Строки регистра упорядочиваются по регистратору и номеру строки.
     */
    private list(description: ObjectDescription, payload: unknown): Effect.Effect<unknown, unknown> {
        return Effect.gen(function* (this: DataService) {
            const options = objectValue(payload, 'payload');
            const { page, pageSize, offset } = pageOptions(options);
            const filters = options['filter'] ?? [];
            const sorting = options['sort'] ?? [];
            if (!Array.isArray(filters) || !Array.isArray(sorting)) return yield* new DataValidationError({ message: 'Отбор и сортировка должны быть списками', fields: ['payload.filter', 'payload.sort'] });
            const where: SqlFilter[] = [];
            const predicates: RowPredicate[] = [];
            for (const raw of filters) {
                const filter = objectValue(raw, 'payload.filter');
                const name = stringValue(filter['field'], 'payload.filter.field');
                const field = description.fields.find((candidate) => candidate.name === name);
                if (field === undefined) return yield* new DataValidationError({ message: `Неизвестное поле отбора «${name}»`, fields: [`payload.filter.${name}`] });
                const operator = filter['operator'] as FilterOperator;
                // Допустимые способы сравнения те же, что описание списка предлагает клиенту.
                if (!filterOperators[field.kind].includes(operator)) {
                    return yield* new DataValidationError({ message: `Недопустимый способ сравнения для «${name}»`, fields: [`payload.filter.${name}`] });
                }
                if (operator === 'contains') {
                    if (typeof filter['value'] !== 'string') {
                        return yield* new DataValidationError({ message: `Для поиска по «${name}» нужна строка`, fields: [`payload.filter.${name}`] });
                    }
                    const text = searchText(filter['value']);
                    predicates.push((row) => typeof row[name] === 'string' && searchText(row[name]).includes(text));
                    continue;
                }
                const value = filter['value'];
                if (value === undefined || (value === null && operator !== 'equals' && operator !== 'notEquals')) {
                    return yield* new DataValidationError({ message: `Неверное значение отбора «${name}»`, fields: [`payload.filter.${name}`] });
                }
                if (value !== null) yield* validated(fieldSchema(field), value, `payload.filter.${name}`);
                if (field.kind === 'recorder') {
                    // Регистратор всегда заполнен: равенство null не находит строк, неравенство null — все строки.
                    if (value === null) {
                        if (operator === 'equals') predicates.push(() => false);
                        continue;
                    }
                    const recorder = value as { readonly document: string; readonly guid: string };
                    if (operator === 'equals') {
                        where.push({ column: 'recorderDocument', operator: '=', value: recorder.document });
                        where.push({ column: 'recorderGuid', operator: '=', value: recorder.guid });
                    } else {
                        // Turso 0.8 умеет сравнивать пары `(a, b) != (?, ?)`, но группа OR выражает то же
                        // средствами конструктора запросов. Колонки регистратора NOT NULL, поэтому
                        // неравенство не встретит NULL и оба способа дают одинаковый результат.
                        where.push({ any: [
                            { column: 'recorderDocument', operator: '!=', value: recorder.document },
                            { column: 'recorderGuid', operator: '!=', value: recorder.guid },
                        ] });
                    }
                    continue;
                }
                where.push({ column: name, operator: sqlOperators[operator], value: sqlValue(value) });
            }
            const orderBy: SqlOrder[] = [];
            for (const raw of sorting) {
                const sort = objectValue(raw, 'payload.sort');
                const name = stringValue(sort['field'], 'payload.sort.field');
                const direction = sort['direction'];
                // Регистратор хранится в двух колонках и в описании списка не сортируется.
                const field = description.fields.find((candidate) => candidate.name === name);
                if (field === undefined || field.kind === 'recorder' || (direction !== 'ascending' && direction !== 'descending')) {
                    return yield* new DataValidationError({ message: `Неверная сортировка по «${name}»`, fields: [`payload.sort.${name}`] });
                }
                orderBy.push({ column: name, direction: direction === 'ascending' ? 'ASC' : 'DESC' });
            }
            // При одинаковых значениях сортировки ключ таблицы задаёт однозначный порядок строк.
            // У строки регистра нет guid: её определяют регистратор и номер строки.
            const key = description.kind === 'register' ? ['recorderDocument', 'recorderGuid', 'lineNumber'] : ['guid'];
            for (const column of key) {
                if (!orderBy.some((order) => order.column === column)) orderBy.push({ column, direction: 'ASC' });
            }
            const table = tableName(description);
            const database = this.database.effect;
            if (predicates.length > 0) {
                const items: RecordValue[] = [];
                let total = 0;
                let scanned = 0;
                const chunkSize = 500;
                while (true) {
                    // Turso LIKE обрабатывает % и _ как шаблон и не складывает регистр кириллицы.
                    // Читаем кандидатов порциями, применяя такие условия до выбора страницы.
                    const candidates = yield* database.all<RecordValue>(select(table, { where, orderBy, limit: chunkSize, offset: scanned }));
                    for (const row of candidates) {
                        if (!predicates.every((predicate) => predicate(row))) continue;
                        total++;
                        if (total > offset && items.length < pageSize) items.push(recordFromRow(row, description));
                    }
                    scanned += candidates.length;
                    if (candidates.length < chunkSize) break;
                }
                return { items, total, page, pageSize };
            }
            // Подзапрос повторяет тот же отбор, чтобы total не зависел от размера текущей страницы.
            const filtered = select(table, { where });
            const count = yield* database.get<{ total: number }>({
                sql: `SELECT COUNT(*) AS total FROM (${filtered.sql})`,
                parameters: filtered.parameters,
            });
            const rows = yield* database.all<RecordValue>(select(table, { where, orderBy, limit: pageSize, offset }));
            return { items: rows.map((row) => recordFromRow(row, description)), total: count?.total ?? 0, page, pageSize };
        }.bind(this));
    }

    /**
     * Проверяет полное состояние полей и частей до записи и собирает план сохранения. Новый
     * документ получает номер внутри транзакции, но изменяющие запросы выполняются после политик.
     */
    private prepareSave(description: ObjectDescription, payload: unknown, before: RecordValue | undefined): Effect.Effect<PreparedMutation, unknown, ActionRequirements> {
        return Effect.gen(function* (this: DataService) {
            const request = objectValue(payload, 'payload');
            const guid = request['guid'] === undefined ? newGuid() : stringValue(request['guid'], 'payload.guid');
            if (request['guid'] !== undefined) yield* validated(fieldSchema(description.fields.find((field) => field.name === 'guid')!), guid, 'payload.guid');
            const input = yield* validated(inputSchema(description), request['fields'], 'payload.fields') as Effect.Effect<RecordValue, DataValidationError>;
            const values: Record<string, SqlValue> = { guid, deletedAt: null };
            for (const field of description.fields) {
                if (!field.managed) values[field.name] = sqlValue(input[field.name]);
            }
            const creating = request['guid'] === undefined;
            if (creating && description.kind === 'document') {
                values['number'] = yield* this.nextNumber(description);
                values['posted'] = 0;
            }
            const proposed: RecordValue = {
                ...before,
                ...input,
                guid,
                deletedAt: before?.['deletedAt'] ?? null,
                ...(description.kind === 'document' ? {
                    number: before?.['number'] ?? values['number'],
                    posted: before?.['posted'] ?? false,
                } : {}),
            };
            return {
                policy: { action: 'save', input: { before: before ?? null, after: proposed } },
                apply: this.applySave(description, guid, input, values, creating),
            } satisfies PreparedMutation;
        }.bind(this));
    }

    /** Сохраняет подготовленные поля и части; проведённый документ затем проводит заново. */
    private applySave(
        description: ObjectDescription,
        guid: string,
        input: RecordValue,
        values: Record<string, SqlValue>,
        creating: boolean,
    ): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.gen(function* (this: DataService) {
            const database = this.database.effect;
            if (creating) {
                yield* database.run(insert(tableName(description), values));
            } else {
                // Обновление не снимает ранее установленную пометку удаления.
                const { guid: _guid, deletedAt: _deletedAt, ...changed } = values;
                const result = yield* database.run(update(tableName(description), changed, [{ column: 'guid', operator: '=', value: guid }]));
                if (result.changes === 0) return yield* new DataNotFoundError({ message: `Запись ${description.name} с guid ${guid} не найдена` });
            }
            for (const part of description.tableParts) {
                const table = `${tableName(description)}_${part.name}`;
                // Табличная часть передана целиком; удаление старых строк и вставка новых атомарны.
                yield* database.run(remove(table, [{ column: 'ownerGuid', operator: '=', value: guid }]));
                const rows = input[part.name] as RecordValue[];
                for (const [index, row] of rows.entries()) {
                    const fields: Record<string, SqlValue> = { ownerGuid: guid, lineNumber: index + 1 };
                    for (const field of part.fields) fields[field.name] = sqlValue(row[field.name]);
                    yield* database.run(insert(table, fields));
                }
            }
            return yield* afterSave(description, guid);
        }.bind(this));
    }

    /**
     * Выдаёт следующий номер документа: наибольший номер плюс один, дополненный нулями до
     * `numberWidth` знаков. Номер выдаётся внутри изменяющей транзакции, а такие транзакции
     * выполняются по очереди, поэтому два документа не получат один номер.
     */
    private nextNumber(description: ObjectDescription): Effect.Effect<string, unknown> {
        return Effect.gen(function* (this: DataService) {
            // CAST сравнивает номера как числа: после 999999 строковое сравнение нарушило бы порядок.
            const row = yield* this.database.effect.get<{ last: number | null }>({
                sql: `SELECT MAX(CAST(${sqlIdentifier('number')} AS INTEGER)) AS last FROM ${sqlIdentifier(tableName(description))}`,
                parameters: [],
            });
            return String((row?.last ?? 0) + 1).padStart(numberWidth, '0');
        }.bind(this));
    }
}
