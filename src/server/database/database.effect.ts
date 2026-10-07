import type { Database as TursoDatabase, Transaction } from '@tursodatabase/database';
import { Context, Effect, Exit, Option } from 'effect';
import { DatabaseError } from './database.errors.js';
import type { TypedSqlQuery } from './typed-query.js';
import type { SqlQuery, SqlValue } from './sql.builder.js';

/**
 * Операции над одним соединением Turso, доступные бизнес-логике как сервис Effect.
 * Запрос хранит SQL и параметры отдельно: драйвер связывает значения при выполнении.
 */
export interface Database {
    /** Возвращает первую строку или `undefined`; типизированный запрос выводит тип и преобразует значения. */
    get<Row extends Record<string, unknown>>(query: SqlQuery | TypedSqlQuery<Row>): Effect.Effect<Row | undefined, DatabaseError>;
    /** Возвращает строки с преобразованием типизированного запроса; вне транзакции ждёт её завершения. */
    all<Row extends Record<string, unknown>>(query: SqlQuery | TypedSqlQuery<Row>): Effect.Effect<readonly Row[], DatabaseError>;
    /** Выполняет изменяющий запрос. Вне транзакции драйвер упорядочивает его с остальными запросами. */
    run(query: SqlQuery): Effect.Effect<DatabaseRunResult, DatabaseError>;
    /**
     * Выполняет несколько действий атомарно. Вложенный вызов продолжает текущую транзакцию;
     * внешняя транзакция решает, подтвердить изменения или откатить их.
     */
    transaction<Value, Error, Requirements>(
        work: Effect.Effect<Value, Error, Requirements>,
    ): Effect.Effect<Value, Error | DatabaseError, Requirements>;
}

/** Число изменённых строк и идентификатор последней вставленной строки от Turso. */
export interface DatabaseRunResult {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
}

/** Тег для передачи сервиса из Nest-провайдера в окружение бизнес-логики Effect. */
export const Database = Context.Service<Database>('Database');

/** Дескриптор принадлежит только открывшей его транзакции и её вложенным действиям. */
interface TransactionContext {
    readonly connection: Transaction;
}

const CurrentTransaction = Context.Service<TransactionContext>('Database.CurrentTransaction');

/**
 * Создаёт Effect-сервис поверх единственного соединения процесса. Нативная блокировка драйвера
 * удерживает соединение до подтверждения или отката, а запросы внутри идут через дескриптор.
 */
export function makeDatabase(connection: TursoDatabase): Database {
    const execute = <Value>(
        operation: string,
        query: SqlQuery,
        call: (database: TursoDatabase | Transaction, parameters: readonly SqlValue[]) => Promise<Value>,
    ): Effect.Effect<Value, DatabaseError> =>
        Effect.gen(function* () {
            const current = yield* Effect.serviceOption(CurrentTransaction);
            return yield* Effect.tryPromise({
                try: () => call(Option.isSome(current) ? current.value.connection : connection, query.parameters),
                catch: (cause) => new DatabaseError({ operation, cause }),
            });
        });

    /**
     * Вложенный вызов пользуется текущим дескриптором. Повторное открытие транзакции
     * ожидало бы блокировку соединения, которую уже удерживает внешний вызов.
     */
    const inTransaction = <Value, Error, Requirements>(
        work: Effect.Effect<Value, Error, Requirements>,
    ): Effect.Effect<Value, Error | DatabaseError, Requirements> =>
        Effect.gen(function* () {
            const current = yield* Effect.serviceOption(CurrentTransaction);
            if (Option.isSome(current)) return yield* work;
            const context = yield* Effect.context<Requirements>();
            return yield* Effect.callback<Value, Error | DatabaseError>((resume, signal) => {
                // Драйвер откатывает транзакцию при отклонении callback. Сохраняем полный Exit,
                // чтобы после отката вернуть исходную ошибку или прерывание Effect.
                let workFailure: Exit.Failure<Value, Error> | undefined;
                const transaction = Promise.resolve().then(() => connection.transactionAsync(async (handle) => {
                    const operation = Effect.provideService(Effect.provide(work, context), CurrentTransaction, { connection: handle });
                    const result = await Effect.runPromiseExit(operation, { signal });
                    if (Exit.isFailure(result)) {
                        workFailure = result;
                        throw result;
                    }
                    return result.value;
                }).immediate());
                void transaction.then(
                    (value) => resume(Effect.succeed(value)),
                    (cause) => resume(workFailure !== undefined && cause === workFailure
                        ? Effect.failCause(workFailure.cause)
                        : Effect.fail(new DatabaseError({ operation: 'transaction', cause }))),
                );
                // После прерывания ждём нативного ROLLBACK до освобождения соединения.
                return Effect.promise(() => transaction.then(() => undefined, () => undefined));
            });
        });

    return {
        get: <Row extends Record<string, unknown>>(query: SqlQuery | TypedSqlQuery<Row>) =>
            execute<Row | undefined>('get', query, async (database, parameters) => {
                const row = await database.get(query.sql, ...parameters) as Row | undefined;
                return row === undefined || !('decodeRow' in query) ? row : query.decodeRow(row);
            }),
        all: <Row extends Record<string, unknown>>(query: SqlQuery | TypedSqlQuery<Row>) =>
            execute<readonly Row[]>('all', query, async (database, parameters) => {
                const rows = await database.all(query.sql, ...parameters) as Row[];
                return 'decodeRow' in query ? rows.map(query.decodeRow) : rows;
            }),
        run: (query: SqlQuery) =>
            execute<DatabaseRunResult>('run', query, (database, parameters) => database.run(query.sql, ...parameters)),
        transaction: inTransaction,
    };
}
