import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { DatabaseService } from '../database/database.service.js';
import { Database } from '../database/database.effect.js';
import { insert, remove, select, sqlIdentifier, update, type SqlCondition, type SqlOrder, type SqlValue } from '../database/sql.builder.js';
import type { ObjectDescription, RegisterMovements } from '../metadata/descriptions.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { actionInputSchema, fieldSchema, fieldsSchema, inputSchema } from '../metadata/schema.js';
import { filterOperators, type FilterOperator } from '../ui/descriptions.js';
import { ActionContext, ActionDispatcher } from './action-context.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';

/** Представление строки после чтения из базы или проверки входных данных. */
type RecordValue = Record<string, unknown>;
/** Внешний запрос после проверки обязательных полей оболочки; payload проверяется для выбранного действия. */
type Operation = { readonly target: { readonly kind: string; readonly name: string }; readonly action: string; readonly payload: unknown };
/**
 * Условие отбора, которое проверяется после чтения строки, а не в SQL: буквальная подстрока
 * и неравенство регистратора, для которого конструктор запросов не умеет строить `OR`.
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

/**
 * Создаёт UUIDv7: первые шесть байт содержат время, остальные заполняются случайными байтами.
 * Версия и вариант задаются отдельно, чтобы идентификаторы оставались совместимыми с UUID.
 */
function newGuid(): string {
    const bytes = randomBytes(16);
    const time = Date.now();
    for (let index = 5; index >= 0; index--) bytes[index] = Math.floor(time / 2 ** ((5 - index) * 8)) & 255;
    bytes[6] = (bytes[6]! & 15) | 0x70;
    bytes[8] = (bytes[8]! & 63) | 0x80;
    const hex = bytes.toString('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Отклоняет массив и null до обращения к полям тела запроса; location попадает в ответ 400. */
function objectValue(value: unknown, location: string): RecordValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new DataValidationError({ message: `Ожидается объект: ${location}`, fields: [location] });
    }
    return value as RecordValue;
}

/** Извлекает обязательную непустую строку из непроверенного тела запроса. */
function stringValue(value: unknown, location: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        throw new DataValidationError({ message: `Нужно указать ${location}`, fields: [location] });
    }
    return value;
}

/** Принимает только точно представимое целое число; значение по умолчанию действует лишь при отсутствии поля. */
function nonnegative(value: unknown, location: string, fallback: number): number {
    if (value === undefined) return fallback;
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new DataValidationError({ message: `${location}: ожидается неотрицательное целое число`, fields: [location] });
    }
    return value as number;
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

/**
 * Собирает все ошибки Effect Schema за один проход и возвращает их вместе с путями полей.
 * Схема передаётся из метаданных выбранного действия; её ошибка становится ответом 400.
 */
function validated<S extends Schema.Top>(schema: S, value: unknown, location: string): Effect.Effect<S['Type'], DataValidationError> {
    // Эти схемы состоят из синхронных полей метаданных и не требуют сервисов декодирования.
    return (Schema.decodeUnknownEffect(schema, { errors: 'all' })(value) as Effect.Effect<S['Type'], Schema.SchemaError>).pipe(
        Effect.mapError((error) => {
            const message = error.message.replaceAll('\n  at ', ' — поле ');
            // Форматтер Effect пишет путь в квадратных скобках; клиенту нужен путь от payload.
            const fields = [...message.matchAll(/поле ([^\n]+)/g)].map((match) =>
                `${location}.${match[1]}`.replaceAll(/\["([^"]+)"\]/g, '$1').replaceAll(/\[(\d+)\]/g, '.$1'),
            );
            return new DataValidationError({ message: `${location}: ${message}`, fields: fields.length ? fields : [location] });
        }),
    );
}

/** Переводит логические значения в 0/1 для колонки INTEGER в таблице STRICT. */
function sqlValue(value: unknown): SqlValue {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string' || typeof value === 'number') return value;
    throw new DataValidationError({ message: 'Неверное значение поля', fields: [] });
}

/**
 * Восстанавливает логические поля после чтения из SQLite и собирает регистратор движения из двух
 * колонок, в которых он хранится. Прочие значения возвращаются без преобразования.
 */
function recordFromRow(row: RecordValue, description: ObjectDescription): RecordValue {
    const { recorderDocument, recorderGuid, ...record } = row;
    for (const field of description.fields) {
        if (field.kind === 'boolean' && record[field.name] !== null) record[field.name] = record[field.name] === 1;
        if (field.kind === 'recorder') record[field.name] = { document: recorderDocument, guid: recorderGuid };
    }
    return record;
}

/**
 * Диспетчер выполняет операции в одной транзакции и предоставляет собственным обработчикам
 * контекст и повторный вход через Effect. Отсутствующие пока права, политики и журнал
 * подключатся к этому пути выполнения в отдельных задачах.
 */
@Injectable()
export class DataService {
    constructor(private readonly metadata: MetadataService, private readonly database: DatabaseService) {}

    /**
     * Принимает одну операцию или непустой пакет. Вся цепочка использует одну транзакцию;
     * при ошибке любой операции откатываются предшествующие записи. Возвращает один результат
     * либо массив в порядке операций; типизированные ошибки переводит фильтр контроллера.
     */
    perform(body: unknown): Promise<unknown> {
        if (Array.isArray(body) && body.length === 0) {
            return Promise.reject(new DataValidationError({ message: 'Пакет операций пуст', fields: ['операции'] }));
        }
        const operations = Array.isArray(body) ? body : [body];
        // Тот же диспетчер доступен обработчикам: вложенный вызов не обходит проверку и транзакцию.
        const dispatcher: ActionDispatcher = { execute: (operation) => this.execute(operation) };
        const program = Effect.forEach(operations, (operation) => this.execute(operation)).pipe(
            (work) => this.database.effect.transaction(work),
            Effect.provideService(ActionDispatcher, dispatcher),
            Effect.provideService(Database, this.database.effect),
            Effect.map((results) => Array.isArray(body) ? results : results[0]),
        );
        return Effect.runPromise(program);
    }

    /** Находит цель и даёт каждому действию свой контекст, наследуя трассу и пользователя у вложенного. */
    private execute(value: unknown): Effect.Effect<unknown, unknown, ActionDispatcher> {
        return Effect.gen(function* (this: DataService) {
            const operation = parseOperation(value);
            const description = this.metadata.find(operation.target.kind as ObjectDescription['kind'], operation.target.name);
            if (description === undefined) {
                return yield* new DataNotFoundError({ message: `Объект ${operation.target.kind}.${operation.target.name} не найден` });
            }
            // У внешней операции родителя нет; вложенная получает текущий контекст из Effect.
            const parent = yield* Effect.serviceOption(ActionContext);
            const context: ActionContext = {
                userGuid: parent._tag === 'Some' ? parent.value.userGuid : null,
                traceGuid: parent._tag === 'Some' ? parent.value.traceGuid : newGuid(),
                actionGuid: newGuid(),
                parentActionGuid: parent._tag === 'Some' ? parent.value.actionGuid : null,
            };
            return yield* Effect.provideService(this.dispatch(description, operation.action, operation.payload), ActionContext, context);
        }.bind(this));
    }

    /** Выбирает стандартное или собственное действие; неизвестное действие возвращает 404. */
    private dispatch(description: ObjectDescription, action: string, payload: unknown): Effect.Effect<unknown, unknown, ActionContext | ActionDispatcher> {
        if (description.kind !== 'register') {
            switch (action) {
                case 'list': return this.list(description, payload);
                case 'get': return this.get(description, payload);
                case 'save': return this.save(description, payload);
                case 'markDeleted': return this.markDeleted(description, payload, true);
                case 'unmarkDeleted': return this.markDeleted(description, payload, false);
            }
        }
        if (description.kind === 'document') {
            switch (action) {
                case 'post': return this.post(description, payload);
                case 'unpost': return this.unpost(description, payload);
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
            return Effect.gen(function* () {
                const schema = actionInputSchema(description, action)!;
                const input = yield* validated(schema, payload, 'payload');
                // Описания хранят обработчики с разными типами аргументов; вызов допустим после проверки по его схеме.
                const result = custom.handler!(input as never);
                if (!Effect.isEffect(result)) return yield* Effect.die(new Error('Обработчик действия должен вернуть Effect'));
                return yield* result as Effect.Effect<unknown, unknown, ActionContext | ActionDispatcher>;
            }.bind(this));
        }
        return Effect.fail(new DataNotFoundError({ message: `Действие «${action}» для ${description.kind}.${description.name} не найдено` }));
    }

    /** Имя таблицы выводится только из проверенных метаданных, а не из произвольной строки запроса. */
    private table(description: ObjectDescription): string {
        return `${description.kind}_${description.name}`;
    }

    /** Проверяет идентификатор в действиях чтения и пометки до запроса к базе. */
    private guidPayload(payload: unknown): string {
        const value = objectValue(payload, 'payload');
        const guid = stringValue(value['guid'], 'payload.guid');
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(guid)) {
            throw new DataValidationError({ message: 'Ожидается guid', fields: ['payload.guid'] });
        }
        return guid;
    }

    /** Читает одну запись вместе со всеми табличными частями; отсутствующая запись даёт 404. */
    private get(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown> {
        return this.load(description, this.guidPayload(payload));
    }

    /** Собирает запись из основной таблицы и таблиц частей, сохраняя порядок строк по lineNumber. */
    private load(description: ObjectDescription, guid: string): Effect.Effect<RecordValue, unknown> {
        return Effect.gen(function* (this: DataService) {
            const database = this.database.effect;
            const row = yield* database.get<RecordValue>(select(this.table(description), { where: [{ column: 'guid', operator: '=', value: guid }] }));
            if (row === undefined) return yield* new DataNotFoundError({ message: `Запись ${description.name} с guid ${guid} не найдена` });
            const record = recordFromRow(row, description);
            for (const part of description.tableParts) {
                const table = `${this.table(description)}_${part.name}`;
                const rows = yield* database.all<RecordValue>(select(table, {
                    where: [{ column: 'ownerGuid', operator: '=', value: guid }],
                    orderBy: [{ column: 'lineNumber', direction: 'ASC' }],
                }));
                // Служебные ключи связывают строку с владельцем, но не входят в значение табличной части.
                record[part.name] = rows.map(({ ownerGuid: _ownerGuid, lineNumber: _lineNumber, ...fields }) => {
                    const result = { ...fields };
                    for (const field of part.fields) if (field.kind === 'boolean' && result[field.name] !== null) result[field.name] = result[field.name] === 1;
                    return result;
                });
            }
            return record;
        }.bind(this));
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
            const page = nonnegative(options['page'], 'payload.page', 1);
            if (page < 1) return yield* new DataValidationError({ message: 'Номер страницы должен быть больше нуля', fields: ['payload.page'] });
            const pageSize = nonnegative(options['pageSize'], 'payload.pageSize', 50);
            if (pageSize < 1 || pageSize > 500) return yield* new DataValidationError({ message: 'Размер страницы должен быть от 1 до 500', fields: ['payload.pageSize'] });
            const offset = (page - 1) * pageSize;
            if (!Number.isSafeInteger(offset)) return yield* new DataValidationError({ message: 'Номер страницы слишком велик', fields: ['payload.page'] });
            const filters = options['filter'] ?? [];
            const sorting = options['sort'] ?? [];
            if (!Array.isArray(filters) || !Array.isArray(sorting)) return yield* new DataValidationError({ message: 'Отбор и сортировка должны быть списками', fields: ['payload.filter', 'payload.sort'] });
            const where: SqlCondition[] = [];
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
                        predicates.push((row) => row['recorderDocument'] !== recorder.document || row['recorderGuid'] !== recorder.guid);
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
            const table = this.table(description);
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
     * Создаёт запись без guid или заменяет значения существующей записи с guid. Клиент передаёт
     * полное состояние заполняемых полей и табличных частей; ошибочные значения откатывают запись.
     * Новый документ получает следующий номер и не проведён. Запись проведённого документа
     * заново записывает его движения, чтобы они соответствовали новым данным.
     */
    private save(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, ActionContext | ActionDispatcher> {
        return Effect.gen(function* (this: DataService) {
            const request = objectValue(payload, 'payload');
            const guid = request['guid'] === undefined ? newGuid() : stringValue(request['guid'], 'payload.guid');
            if (request['guid'] !== undefined) yield* validated(fieldSchema(description.fields.find((field) => field.name === 'guid')!), guid, 'payload.guid');
            const input = yield* validated(inputSchema(description), request['fields'], 'payload.fields') as Effect.Effect<RecordValue, DataValidationError>;
            const values: Record<string, SqlValue> = { guid, deletedAt: null };
            for (const field of description.fields) {
                if (!field.managed) values[field.name] = sqlValue(input[field.name]);
            }
            const database = this.database.effect;
            let posted = false;
            if (request['guid'] === undefined) {
                if (description.kind === 'document') {
                    values['number'] = yield* this.nextNumber(description);
                    values['posted'] = 0;
                }
                yield* database.run(insert(this.table(description), values));
            } else {
                posted = (yield* this.load(description, guid))['posted'] === true;
                // Обновление не снимает ранее установленную пометку удаления.
                const { guid: _guid, deletedAt: _deletedAt, ...changed } = values;
                yield* database.run(update(this.table(description), changed, [{ column: 'guid', operator: '=', value: guid }]));
            }
            for (const part of description.tableParts) {
                const table = `${this.table(description)}_${part.name}`;
                // Табличная часть передана целиком; удаление старых строк и вставка новых атомарны.
                yield* database.run(remove(table, [{ column: 'ownerGuid', operator: '=', value: guid }]));
                const rows = input[part.name] as RecordValue[];
                for (const [index, row] of rows.entries()) {
                    const fields: Record<string, SqlValue> = { ownerGuid: guid, lineNumber: index + 1 };
                    for (const field of part.fields) fields[field.name] = sqlValue(row[field.name]);
                    yield* database.run(insert(table, fields));
                }
            }
            if (posted) yield* this.writeMovements(description, yield* this.load(description, guid));
            return yield* this.load(description, guid);
        }.bind(this));
    }

    /**
     * Меняет пометку удаления и возвращает запись с её актуальными значениями. Пометка отменяет
     * проведение документа: помеченный документ не должен влиять на обороты регистров.
     * Снятие пометки документ не проводит, это делает отдельное действие `post`.
     */
    private markDeleted(description: ObjectDescription, payload: unknown, marked: boolean): Effect.Effect<RecordValue, unknown> {
        return Effect.gen(function* (this: DataService) {
            const guid = this.guidPayload(payload);
            const record = yield* this.load(description, guid);
            const values: Record<string, SqlValue> = { deletedAt: marked ? new Date().toISOString() : null };
            if (marked && record['posted'] === true) {
                yield* this.removeMovements(description, guid);
                values['posted'] = 0;
            }
            yield* this.database.effect.run(update(this.table(description), values, [{ column: 'guid', operator: '=', value: guid }]));
            return yield* this.load(description, guid);
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
                sql: `SELECT MAX(CAST(${sqlIdentifier('number')} AS INTEGER)) AS last FROM ${sqlIdentifier(this.table(description))}`,
                parameters: [],
            });
            return String((row?.last ?? 0) + 1).padStart(numberWidth, '0');
        }.bind(this));
    }

    /**
     * Проводит документ: отмечает его проведённым и заменяет его движения строками, которые
     * вернул обработчик проведения. Повторное проведение не дублирует движения. Документ,
     * помеченный на удаление, провести нельзя.
     */
    private post(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, ActionContext | ActionDispatcher> {
        return Effect.gen(function* (this: DataService) {
            const guid = this.guidPayload(payload);
            const record = yield* this.load(description, guid);
            if (record['deletedAt'] !== null) {
                return yield* new DataValidationError({ message: 'Документ помечен на удаление, провести его нельзя', fields: ['payload.guid'] });
            }
            yield* this.database.effect.run(update(this.table(description), { posted: 1 }, [{ column: 'guid', operator: '=', value: guid }]));
            // Обработчик получает запись уже с признаком проведения, как она будет видна после действия.
            yield* this.writeMovements(description, yield* this.load(description, guid));
            return yield* this.load(description, guid);
        }.bind(this));
    }

    /** Отменяет проведение: удаляет движения документа и снимает признак проведения. */
    private unpost(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown> {
        return Effect.gen(function* (this: DataService) {
            const guid = this.guidPayload(payload);
            yield* this.load(description, guid);
            yield* this.removeMovements(description, guid);
            yield* this.database.effect.run(update(this.table(description), { posted: 0 }, [{ column: 'guid', operator: '=', value: guid }]));
            return yield* this.load(description, guid);
        }.bind(this));
    }

    /**
     * Удаляет движения документа во всех регистрах конфигурации, а не только в тех, куда пишет
     * текущий обработчик проведения: после изменения данных документа обработчик может перестать
     * писать в регистр, и старые строки остались бы в нём.
     */
    private removeMovements(description: ObjectDescription, guid: string): Effect.Effect<void, unknown> {
        return Effect.gen(function* (this: DataService) {
            for (const register of this.metadata.objects.filter((object) => object.kind === 'register')) {
                yield* this.database.effect.run(remove(this.table(register), [
                    { column: 'recorderDocument', operator: '=', value: description.name },
                    { column: 'recorderGuid', operator: '=', value: guid },
                ]));
            }
        }.bind(this));
    }

    /**
     * Заменяет движения документа строками обработчика проведения. Строки проверяются по описанию
     * регистра так же, как входные данные записи; ошибка отменяет проведение вместе с транзакцией.
     * Регистратор и номер строки заполняет платформа, период по умолчанию равен дате документа.
     */
    private writeMovements(description: ObjectDescription, record: RecordValue): Effect.Effect<void, unknown, ActionContext | ActionDispatcher> {
        return Effect.gen(function* (this: DataService) {
            const guid = record['guid'] as string;
            yield* this.removeMovements(description, guid);
            if (description.posting === null) return;
            // Описание хранит обработчики разных документов; вызов допустим с записью этого документа.
            const result = description.posting(record as never);
            if (!Effect.isEffect(result)) return yield* Effect.die(new Error('Обработчик проведения должен вернуть Effect'));
            const groups = yield* result as Effect.Effect<unknown, unknown, ActionContext | ActionDispatcher>;
            if (!Array.isArray(groups)) return yield* Effect.die(new Error('Обработчик проведения должен вернуть список движений'));
            // Номера строк сквозные внутри регистра, даже если обработчик вернул для него несколько групп.
            const lineNumbers = new Map<string, number>();
            for (const group of groups as ReadonlyArray<RegisterMovements>) {
                const register = this.metadata.find('register', group.register);
                if (register === undefined) return yield* Effect.die(new Error(`Регистр «${group.register}» не найден в конфигурации`));
                const fields = register.fields.filter((field) => !field.managed);
                const rows = group.rows.map((row) => ({ ...row, period: row['period'] ?? record['date'] }));
                const checked = yield* validated(Schema.Array(fieldsSchema(fields)), rows, `проведение.${register.name}`) as Effect.Effect<ReadonlyArray<RecordValue>, DataValidationError>;
                for (const row of checked) {
                    const lineNumber = (lineNumbers.get(register.name) ?? 0) + 1;
                    lineNumbers.set(register.name, lineNumber);
                    const values: Record<string, SqlValue> = { recorderDocument: description.name, recorderGuid: guid, lineNumber };
                    for (const field of fields) values[field.name] = sqlValue(row[field.name]);
                    yield* this.database.effect.run(insert(this.table(register), values));
                }
            }
        }.bind(this));
    }
}
