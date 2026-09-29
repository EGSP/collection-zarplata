import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Effect, Schema } from 'effect';
import { DatabaseService } from '../database/database.service.js';
import { Database } from '../database/database.effect.js';
import { insert, remove, select, update, type SqlCondition, type SqlOrder, type SqlValue } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { actionInputSchema, fieldSchema, inputSchema } from '../metadata/schema.js';
import { ActionContext, ActionDispatcher } from './action-context.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';

/** Представление строки после чтения из базы или проверки входных данных. */
type RecordValue = Record<string, unknown>;
/** Внешний запрос после проверки обязательных полей оболочки; payload проверяется для выбранного действия. */
type Operation = { readonly target: { readonly kind: string; readonly name: string }; readonly action: string; readonly payload: unknown };
/** Буквальная подстрока после приведения регистра; не передаётся в SQL как шаблон LIKE. */
type ContainsCondition = { readonly field: string; readonly value: string };

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

/** Восстанавливает логические поля после чтения из SQLite, сохраняя прочие значения без преобразования. */
function recordFromRow(row: RecordValue, description: ObjectDescription): RecordValue {
    const record = { ...row };
    for (const field of description.fields) {
        if (field.kind === 'boolean' && record[field.name] !== null) record[field.name] = record[field.name] === 1;
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
        if (description.kind === 'catalog') {
            switch (action) {
                case 'list': return this.list(description, payload);
                case 'get': return this.get(description, payload);
                case 'save': return this.save(description, payload);
                case 'markDeleted': return this.markDeleted(description, payload, true);
                case 'unmarkDeleted': return this.markDeleted(description, payload, false);
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
     * Для буквальной подстроки проверяет кандидатов порциями до подсчёта и разбиения на страницы.
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
            const contains: ContainsCondition[] = [];
            for (const raw of filters) {
                const filter = objectValue(raw, 'payload.filter');
                const name = stringValue(filter['field'], 'payload.filter.field');
                const field = description.fields.find((candidate) => candidate.name === name);
                if (field === undefined) return yield* new DataValidationError({ message: `Неизвестное поле отбора «${name}»`, fields: [`payload.filter.${name}`] });
                const operator = filter['operator'];
                if (operator === 'contains') {
                    if (field.kind !== 'string' || typeof filter['value'] !== 'string') {
                        return yield* new DataValidationError({ message: `Для поиска по «${name}» нужна строка`, fields: [`payload.filter.${name}`] });
                    }
                    contains.push({ field: name, value: searchText(filter['value']) });
                    continue;
                }
                if (!['=', '!=', '<', '<=', '>', '>='].includes(operator as string)) {
                    return yield* new DataValidationError({ message: `Недопустимый оператор отбора для «${name}»`, fields: [`payload.filter.${name}`] });
                }
                const value = filter['value'];
                if (value === undefined || (value === null && !['=', '!='].includes(operator as string))) {
                    return yield* new DataValidationError({ message: `Неверное значение отбора «${name}»`, fields: [`payload.filter.${name}`] });
                }
                if (value !== null) yield* validated(fieldSchema(field), value, `payload.filter.${name}`);
                where.push({ column: name, operator: operator as SqlCondition['operator'], value: sqlValue(value) });
            }
            const orderBy: SqlOrder[] = [];
            for (const raw of sorting) {
                const sort = objectValue(raw, 'payload.sort');
                const name = stringValue(sort['field'], 'payload.sort.field');
                if (!description.fields.some((field) => field.name === name) || !['ASC', 'DESC'].includes(sort['direction'] as string)) {
                    return yield* new DataValidationError({ message: `Неверная сортировка по «${name}»`, fields: [`payload.sort.${name}`] });
                }
                orderBy.push({ column: name, direction: sort['direction'] as SqlOrder['direction'] });
            }
            // При одинаковых значениях сортировки guid задаёт однозначный порядок строк.
            if (!orderBy.some((order) => order.column === 'guid')) orderBy.push({ column: 'guid', direction: 'ASC' });
            const table = this.table(description);
            const database = this.database.effect;
            if (contains.length > 0) {
                const items: RecordValue[] = [];
                let total = 0;
                let scanned = 0;
                const chunkSize = 500;
                while (true) {
                    // Turso LIKE обрабатывает % и _ как шаблон и не складывает регистр кириллицы.
                    // Читаем кандидатов порциями, применяя буквальный поиск до выбора страницы.
                    const candidates = yield* database.all<RecordValue>(select(table, { where, orderBy, limit: chunkSize, offset: scanned }));
                    for (const row of candidates) {
                        if (!contains.every(({ field, value }) => typeof row[field] === 'string' && searchText(row[field]).includes(value))) continue;
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
     */
    private save(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown> {
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
            if (request['guid'] === undefined) {
                yield* database.run(insert(this.table(description), values));
            } else {
                yield* this.load(description, guid);
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
            return yield* this.load(description, guid);
        }.bind(this));
    }

    /** Меняет только пометку удаления и возвращает запись с её актуальными значениями. */
    private markDeleted(description: ObjectDescription, payload: unknown, marked: boolean): Effect.Effect<RecordValue, unknown> {
        return Effect.gen(function* (this: DataService) {
            const guid = this.guidPayload(payload);
            yield* this.load(description, guid);
            yield* this.database.effect.run(update(this.table(description), {
                deletedAt: marked ? new Date().toISOString() : null,
            }, [{ column: 'guid', operator: '=', value: guid }]));
            return yield* this.load(description, guid);
        }.bind(this));
    }
}
