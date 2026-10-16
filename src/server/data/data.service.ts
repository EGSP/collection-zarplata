import { calculatedInput } from './computed-values.js';
import { Injectable } from '@nestjs/common';
import { Effect } from 'effect';
import { platformRights, requiredRight } from '../authorization/rights.js';
import { CurrentUserRights } from '../authorization/current-user-rights.js';
import { RightsGuardPlatform } from '../authorization/rights-guard.platform.js';
import { newGuid } from '../common/guid.js';
import { DatabaseService } from '../database/database.service.js';
import { Database } from '../database/database.effect.js';
import { query, type QueryFilter, type SqlOrder } from '../database/sql.builder.js';
import type { FieldKind, ObjectDescription } from '../metadata/descriptions.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { MetadataService } from '../metadata/metadata.service.js';
import { actionInputSchema, fieldSchema, inputSchema } from '../metadata/schema.js';
import { readJournal, recordChanges, writeJournal } from '../journal/journal.js';
import { filterOperators, type FilterOperator, type ListColumn } from '../ui/descriptions.js';
import { columnReference } from '../ui/reference-presentation.js';
import { displayedKind, formatSearchValue, normalizeSearchText } from '../ui/value-format.js';
import { ActionContext, ActionDispatcher } from './action-context.js';
import { DataNotFoundError, DataValidationError } from './data.errors.js';
import { afterSave, markDeleted, post, unpost } from './posting.js';
import { filterValue, guidValue, loadRecord, objectValue, pageOptions, sqlOperators, stringValue, validated, type RecordValue } from './records.js';
import { readOnlyDatabase } from './read-only-database.js';
import { enforcePolicies, type PolicyInvocation } from './policies.js';
import { importCatalog } from './import.js';
import { getInformation, mutateInformation } from './information-register.js';
import { totalsAction } from './register-totals.js';
import { lookupAction } from './lookup.js';
import { documentsTarget, repostDocuments } from './reposting.js';
import { buildList } from '../ui/views.js';
import { ListPresentations } from './list-presentations.js';

/** Сервисы, которые получают из окружения Effect стандартные действия и обработчики конфигурации. */
type ActionRequirements = Database | Metadata | ActionContext | ActionDispatcher | CurrentUserRights;
/** Команда изменения: данные для всех применимых политик и эффект, исполняемый после их проверки. */
type MutationOperation = {
    readonly policyArguments: PolicyInvocation;
    readonly execute: Effect.Effect<RecordValue, unknown, ActionRequirements>;
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
 * контекст и повторный вход через Effect. Перед каждой операцией, в том числе вложенной,
 * бизнес-гвард проверяет право пользователя на неё: цель операции известна только из тела
 * запроса, поэтому проверить право на маршруте нельзя. Тому же гварду диспетчер передаёт вопросы
 * конфигурации о правах пользователя: сервис `CurrentUserRights` в окружении действий.
 * Каждое изменяющее действие, в том числе вложенное, записывает строку журнала в той же транзакции.
 */
@Injectable()
export class DataService {
    constructor(
        private readonly metadata: MetadataService,
        private readonly database: DatabaseService,
        private readonly rightsGuard: RightsGuardPlatform,
    ) {}

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
        // Пользователь цепочки не меняется во вложенных действиях, поэтому сервис прав один на запрос.
        // Гвард получает полный сервис базы: внутри транзакции он читает роли через её дескриптор.
        const rights: CurrentUserRights = {
            has: (right) => this.provideServices(this.rightsGuard.rightsOf(userGuid)).pipe(Effect.map((granted) => granted.allows(right))),
            require: (...required) => this.provideServices(this.rightsGuard.require(userGuid, ...required)),
        };
        // Тот же диспетчер доступен обработчикам: вложенный вызов не обходит проверку и транзакцию.
        // Контракт диспетчера не требует от обработчика базы и метаданных, поэтому они передаются здесь.
        const dispatcher: ActionDispatcher = {
            execute: (operation) => this.provideServices(this.execute(operation)).pipe(Effect.provideService(CurrentUserRights, rights)),
        };
        const program = Effect.forEach(operations, (operation) => this.execute(operation, userGuid)).pipe(
            (work) => this.database.effect.transaction(work),
            Effect.provideService(ActionDispatcher, dispatcher),
            Effect.provideService(CurrentUserRights, rights),
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

    /**
     * Находит цель, проверяет право пользователя на действие и даёт каждому действию свой контекст,
     * наследуя трассу и пользователя у вложенного. Вложенное действие проверяется по правам того же
     * пользователя: собственное действие не даёт доступа к объектам, на которые у него нет прав.
     * Отказ завершает операцию `RightsDeniedError` и откатывает всю транзакцию запроса.
     */
    private execute(value: unknown, userGuid: string | null = null): Effect.Effect<unknown, unknown, Exclude<ActionRequirements, ActionContext>> {
        return Effect.gen(function* (this: DataService) {
            const operation = parseOperation(value);
            // У внешней операции родителя нет; вложенная получает текущий контекст из Effect.
            const parent = yield* Effect.serviceOption(ActionContext);
            const user = parent._tag === 'Some' ? parent.value.userGuid : userGuid;
            if (operation.target.kind === journalTarget.kind && operation.target.name === journalTarget.name) {
                yield* this.rightsGuard.require(user, platformRights.journal.read);
                return yield* readJournal(operation.action, operation.payload);
            }
            const context: ActionContext = {
                userGuid: user,
                traceGuid: parent._tag === 'Some' ? parent.value.traceGuid : newGuid(),
                actionGuid: newGuid(),
                parentActionGuid: parent._tag === 'Some' ? parent.value.actionGuid : null,
            };
            if (operation.target.kind === documentsTarget.kind && operation.target.name === documentsTarget.name) {
                if (operation.action !== 'repost') return yield* new DataNotFoundError({ message: `Действие «${operation.action}» для документов не найдено` });
                yield* this.rightsGuard.require(user, platformRights.documents.repost);
                return yield* Effect.provideService(repostDocuments, ActionContext, context);
            }
            const description = this.metadata.find(operation.target.kind as ObjectDescription['kind'], operation.target.name);
            if (description === undefined) {
                return yield* new DataNotFoundError({ message: `Объект ${operation.target.kind}.${operation.target.name} не найден` });
            }
            // Действия, которого у объекта нет, право не защищает: диспетчер ответит, что оно не найдено.
            const right = requiredRight(description, operation.action);
            if (right !== undefined) yield* this.rightsGuard.require(user, right);
            return yield* Effect.provideService(this.dispatch(description, operation.action, operation.payload), ActionContext, context);
        }.bind(this));
    }

    /** Выбирает стандартное или собственное действие; неизвестное действие возвращает 404. */
    private dispatch(description: ObjectDescription, action: string, payload: unknown): Effect.Effect<unknown, unknown, ActionRequirements> {
        if (description.kind === 'informationRegister') {
            switch (action) {
                case 'list': return this.list(description, payload);
                case 'get': return getInformation(description, payload);
                case 'save': return mutateInformation(description, 'save', payload);
                case 'delete': return mutateInformation(description, 'delete', payload);
            }
        }
        if (description.kind === 'catalog' && action === 'import') return importCatalog(description, payload);
        if (description.kind === 'catalog' || description.kind === 'document') {
            switch (action) {
                case 'list': return this.list(description, payload);
                case 'get': return this.get(description, payload);
                case 'save': return this.mutateSave(description, payload);
                case 'markDeleted': return this.mutateMarkDeleted(description, payload);
                case 'unmarkDeleted': return this.mutateUnmarkDeleted(description, payload);
                case 'lookup': return lookupAction(description, payload);
            }
        }
        if (description.kind === 'document') {
            switch (action) {
                case 'post': return this.mutatePost(description, payload);
                case 'unpost': return this.mutateUnpost(description, payload);
            }
        }
        if (description.kind === 'register') {
            if (action === 'list') return this.list(description, payload);
            if (action === 'totals') return totalsAction(description, payload);
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
                const computed = yield* calculatedInput(custom.input, custom.tableParts, payload, 'payload');
                const input = yield* validated(schema, computed, 'payload');
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
     * Сохраняет запись через общий конвейер; новый объект ещё не имеет существующей записи.
     *
     * Документ можно записать и провести одним запросом: `post: true` в запросе проводит записанный
     * документ вложенным действием `post`. Оба действия идут в транзакции запроса, поэтому отказ
     * проведения отменяет и запись: новый документ не остаётся черновиком. Вложенное проведение
     * проверяется по правам того же пользователя, как и самостоятельное.
     */
    private mutateSave(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.gen(function* (this: DataService) {
            const request = objectValue(payload, 'payload');
            const guid = request['guid'] === undefined ? undefined : this.guidPayload(payload);
            const withPosting = request['post'] === true;
            if (withPosting && description.kind !== 'document') {
                return yield* new DataValidationError({ message: 'Проводить при записи можно только документ', fields: ['payload.post'] });
            }
            const saved = yield* this.mutate(description, 'save', guid, (existingRecord) => this.prepareSave(description, payload, existingRecord));
            if (!withPosting) return saved;
            const dispatcher = yield* ActionDispatcher;
            return (yield* dispatcher.execute({ target: { kind: description.kind, name: description.name }, action: 'post', payload: { guid: saved['guid'] } })) as RecordValue;
        }.bind(this));
    }

    /** Помечает существующую запись на удаление после проверки её политик. */
    private mutateMarkDeleted(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.suspend(() => {
            const guid = this.guidPayload(payload);
            return this.mutate(description, 'markDeleted', guid, (existingRecord) => Effect.succeed({
                policyArguments: { action: 'markDeleted', input: { record: existingRecord! } },
                execute: markDeleted(description, guid, true),
            }));
        });
    }

    /** Снимает пометку удаления после проверки политик существующей записи. */
    private mutateUnmarkDeleted(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.suspend(() => {
            const guid = this.guidPayload(payload);
            return this.mutate(description, 'unmarkDeleted', guid, (existingRecord) => Effect.succeed({
                policyArguments: { action: 'unmarkDeleted', input: { record: existingRecord! } },
                execute: markDeleted(description, guid, false),
            }));
        });
    }

    /** Проводит существующий документ после проверки его политик. */
    private mutatePost(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.suspend(() => {
            const guid = this.guidPayload(payload);
            return this.mutate(description, 'post', guid, (existingRecord) => Effect.succeed({
                policyArguments: { action: 'post', input: { document: existingRecord! } },
                execute: post(description, guid),
            }));
        });
    }

    /** Отменяет проведение существующего документа после проверки его политик. */
    private mutateUnpost(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.suspend(() => {
            const guid = this.guidPayload(payload);
            return this.mutate(description, 'unpost', guid, (existingRecord) => Effect.succeed({
                policyArguments: { action: 'unpost', input: { document: existingRecord! } },
                execute: unpost(description, guid),
            }));
        });
    }

    /**
     * Читает запись, строит команду, вызывает все политики, исполняет её и пишет результат в журнал.
     * Построение команды не меняет базу; ошибка откатывает всю транзакцию, включая вложенные действия.
     */
    private mutate(
        description: ObjectDescription,
        action: string,
        guid: string | undefined,
        createOperation: (existingRecord: RecordValue | undefined) => Effect.Effect<MutationOperation, unknown, ActionRequirements>,
    ): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.gen(function* (this: DataService) {
            const occurredAt = new Date().toISOString();
            const existingRecord = guid === undefined ? undefined : yield* loadRecord(description, guid);
            const operation = yield* createOperation(existingRecord);
            yield* enforcePolicies(description, operation.policyArguments);
            const resultRecord = yield* operation.execute;
            yield* writeJournal({
                occurredAt,
                target: { kind: description.kind, name: description.name, guid: resultRecord['guid'] as string },
                action,
                changes: recordChanges(description, existingRecord, resultRecord),
            });
            const context = yield* ActionContext;
            const presentations = new ListPresentations(this.metadata.objects, yield* this.rightsGuard.rightsOf(context.userGuid), []);
            yield* presentations.loadOwn(description, [resultRecord]);
            return resultRecord;
        }.bind(this));
    }

    /** Читает одну запись вместе со всеми табличными частями; отсутствующая запись даёт 404. */
    private get(description: ObjectDescription, payload: unknown): Effect.Effect<RecordValue, unknown, Database | ActionContext> {
        return Effect.gen(function* (this: DataService) {
            const record = yield* loadRecord(description, this.guidPayload(payload));
            const context = yield* ActionContext;
            const presentations = new ListPresentations(this.metadata.objects, yield* this.rightsGuard.rightsOf(context.userGuid), []);
            yield* presentations.loadOwn(description, [record]);
            return record;
        }.bind(this));
    }

    /**
     * Выбирает страницу и общее число строк по одному отбору. Поля сверяются с метаданными,
     * поэтому их имена могут безопасно участвовать в построении SQL; значения остаются параметрами.
     * Условия, которые нельзя выразить в SQL, проверяет на кандидатах порциями до подсчёта
     * и разбиения на страницы. Строки регистра упорядочиваются по регистратору и номеру строки.
     * Отдельный поиск проверяет каждую видимую колонку по её отображаемому тексту; ссылки
     * читаются пакетами с проверкой прав, а представления страницы возвращаются клиенту.
     * Отбор `presentation` ищет подстроку в представлении самой записи: по нему поле выбора
     * находит запись под тем же текстом, которым она показана.
     */
    private list(description: ObjectDescription, payload: unknown): Effect.Effect<unknown, unknown, Database | ActionContext> {
        return Effect.gen(function* (this: DataService) {
            const options = objectValue(payload, 'payload');
            const { page, pageSize, offset } = pageOptions(options);
            if (options['search'] !== undefined && typeof options['search'] !== 'string') {
                return yield* new DataValidationError({ message: 'Для поиска нужна строка', fields: ['payload.search'] });
            }
            const search = (options['search'] as string | undefined) ?? '';
            if (options['presentation'] !== undefined && typeof options['presentation'] !== 'string') {
                return yield* new DataValidationError({ message: 'Для поиска по представлению нужна строка', fields: ['payload.presentation'] });
            }
            const presentation = normalizeSearchText('string', (options['presentation'] as string | undefined) ?? '');
            // Представление есть только у записей, на которые можно сослаться; строку регистра оно не называет.
            const presented = description.kind === 'catalog' || description.kind === 'document' ? { ...description, kind: description.kind } : null;
            if (presentation !== '' && presented === null) {
                return yield* new DataValidationError({ message: 'Поиск по представлению доступен только для справочников и документов', fields: ['payload.presentation'] });
            }
            const columns = buildList(description).columns;
            const context = yield* ActionContext;
            const rights = yield* this.rightsGuard.rightsOf(context.userGuid);
            const presentations = new ListPresentations(this.metadata.objects, rights, columns);
            const filters = options['filter'] ?? [];
            const sorting = options['sort'] ?? [];
            if (!Array.isArray(filters) || !Array.isArray(sorting)) return yield* new DataValidationError({ message: 'Отбор и сортировка должны быть списками', fields: ['payload.filter', 'payload.sort'] });
            const where: QueryFilter[] = [];
            const predicates: RowPredicate[] = [];
            /**
             * Текст, которым значение колонки показано пользователю, и вид, по правилам которого он
             * сравнивается. Ссылка, в том числе ссылочный вариант составного поля, показана
             * представлением записи; без права чтения цели текста нет, и совпадением она не считается.
             */
            const displayedText = (column: ListColumn, record: RecordValue): { readonly kind: FieldKind; readonly text: string | null } => {
                const value = record[column.field];
                return columnReference(column, value) !== null
                    ? { kind: 'reference', text: presentations.text(column, record) }
                    : { kind: displayedKind(column.kind, value), text: formatSearchValue(column.kind, value) };
            };
            // Подстрока в ссылочном варианте ищется в представлении, которое нужно прочитать до проверки строки.
            let containsNeedsPresentations = false;
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
                    const entered = filter['value'];
                    const column = columns.find((candidate) => candidate.field === name);
                    if (field.kind === 'composite' && column !== undefined) {
                        containsNeedsPresentations = true;
                        predicates.push((row) => {
                            const displayed = displayedText(column, row);
                            return displayed.text !== null && normalizeSearchText(displayed.kind, displayed.text).includes(normalizeSearchText(displayed.kind, entered));
                        });
                        continue;
                    }
                    const text = normalizeSearchText(field.kind, entered);
                    predicates.push((row) => {
                        const displayed = formatSearchValue(field.kind, row[name]);
                        return displayed !== null && normalizeSearchText(field.kind, displayed).includes(text);
                    });
                    continue;
                }
                const value = yield* filterValue(field, operator, filter['value'], `payload.filter.${name}`);
                where.push({ column: name, operator: sqlOperators[operator], value });
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
            const key = description.kind === 'register' ? ['recorder', 'lineNumber']
                : description.kind === 'informationRegister' ? description.fields.filter((field) => field.role === 'dimension').map((field) => field.name) : ['guid'];
            for (const column of key) {
                if (!orderBy.some((order) => order.column === column)) orderBy.push({ column, direction: 'ASC' });
            }
            const builder = query(description);
            const database = this.database.effect;
            if (predicates.length > 0 || search !== '' || presentation !== '') {
                const items: RecordValue[] = [];
                let total = 0;
                let scanned = 0;
                const chunkSize = 500;
                while (true) {
                    // Turso LIKE обрабатывает % и _ как шаблон и не складывает регистр кириллицы.
                    // Читаем кандидатов порциями, применяя такие условия до выбора страницы.
                    const candidates = yield* database.all<RecordValue>(builder.select({ where, orderBy, limit: chunkSize, offset: scanned }));
                    if (containsNeedsPresentations) yield* presentations.load(candidates);
                    const records = candidates.filter((row) => predicates.every((predicate) => predicate(row)));
                    if (search !== '') yield* presentations.load(records);
                    if (presented !== null && presentation !== '') yield* presentations.loadOwn(presented, records);
                    for (const record of records) {
                        if (presented !== null && presentation !== '') {
                            const own = presentations.ownText(presented, record);
                            if (own === null || !normalizeSearchText('string', own).includes(presentation)) continue;
                        }
                        if (search !== '' && !columns.some((column) => {
                            const displayed = displayedText(column, record);
                            return displayed.text !== null && normalizeSearchText(displayed.kind, displayed.text)
                                .includes(normalizeSearchText(displayed.kind, search));
                        })) continue;
                        total++;
                        if (total > offset && items.length < pageSize) items.push(record);
                    }
                    scanned += candidates.length;
                    if (candidates.length < chunkSize) break;
                }
                yield* presentations.load(items);
                if (presented !== null) yield* presentations.loadOwn(presented, items);
                return { items, total, page, pageSize, presentations: presentations.forPage(items) };
            }
            const count = yield* database.get(builder.count({ where }));
            const items = yield* database.all<RecordValue>(builder.select({ where, orderBy, limit: pageSize, offset }));
            yield* presentations.load(items);
            if (presented !== null) yield* presentations.loadOwn(presented, items);
            return { items, total: count?.total ?? 0, page, pageSize, presentations: presentations.forPage(items) };
        }.bind(this));
    }

    /**
     * Проверяет полное состояние полей и частей до записи и собирает план сохранения. Новый
     * документ получает номер внутри транзакции, но изменяющие запросы выполняются после политик.
     */
    private prepareSave(description: ObjectDescription, payload: unknown, existingRecord: RecordValue | undefined): Effect.Effect<MutationOperation, unknown, ActionRequirements> {
        return Effect.gen(function* (this: DataService) {
            const request = objectValue(payload, 'payload');
            const guid = request['guid'] === undefined ? newGuid() : stringValue(request['guid'], 'payload.guid');
            if (request['guid'] !== undefined) yield* validated(fieldSchema(description.fields.find((field) => field.name === 'guid')!), guid, 'payload.guid');
            const computed = yield* calculatedInput(description.fields, description.tableParts, request['fields'], 'payload.fields');
            const input = yield* validated(inputSchema(description), computed, 'payload.fields') as Effect.Effect<RecordValue, DataValidationError>;
            const values: RecordValue = { guid, deletedAt: null };
            for (const field of description.fields) {
                if (!field.managed) values[field.name] = input[field.name] ?? null;
            }
            const creating = request['guid'] === undefined;
            if (creating && description.kind === 'document') {
                values['number'] = yield* this.nextNumber(description);
                values['posted'] = false;
            }
            const proposedRecord: RecordValue = {
                ...existingRecord,
                ...input,
                guid,
                deletedAt: existingRecord?.['deletedAt'] ?? null,
                ...(description.kind === 'document' ? {
                    number: existingRecord?.['number'] ?? values['number'],
                    posted: existingRecord?.['posted'] ?? false,
                } : {}),
            };
            return {
                policyArguments: { action: 'save', input: { existingRecord: existingRecord ?? null, proposedRecord } },
                execute: this.applySave(description, guid, input, values, creating),
            } satisfies MutationOperation;
        }.bind(this));
    }

    /** Сохраняет подготовленные поля и части; проведённый документ затем проводит заново. */
    private applySave(
        description: ObjectDescription,
        guid: string,
        input: RecordValue,
        values: RecordValue,
        creating: boolean,
    ): Effect.Effect<RecordValue, unknown, ActionRequirements> {
        return Effect.gen(function* (this: DataService) {
            const database = this.database.effect;
            if (creating) {
                yield* database.run(query(description).insert(values));
            } else {
                // Обновление не снимает ранее установленную пометку удаления.
                const { guid: _guid, deletedAt: _deletedAt, ...changed } = values;
                const result = yield* database.run(query(description).update(changed, [{ column: 'guid', operator: '=', value: guid }]));
                if (result.changes === 0) return yield* new DataNotFoundError({ message: `Запись ${description.name} с guid ${guid} не найдена` });
            }
            for (const part of description.tableParts) {
                const partQuery = query(description).tablePart(part.name);
                // Табличная часть передана целиком; удаление старых строк и вставка новых атомарны.
                yield* database.run(partQuery.remove([{ column: 'ownerGuid', operator: '=', value: guid }]));
                const rows = input[part.name] as RecordValue[];
                for (const [index, row] of rows.entries()) {
                    const fields: RecordValue & { ownerGuid: string; lineNumber: number } = { ownerGuid: guid, lineNumber: index + 1 };
                    for (const field of part.fields) fields[field.name] = row[field.name] ?? null;
                    yield* database.run(partQuery.insert(fields));
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
            const row = yield* this.database.effect.get(query(description).maximumNumber('number'));
            return String((row?.maximum ?? 0) + 1).padStart(numberWidth, '0');
        }.bind(this));
    }
}
