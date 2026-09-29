import type { Database as TursoDatabase } from '@tursodatabase/database';
import { Context, Effect, Exit, Option, Semaphore } from 'effect';
import { DatabaseError } from './database.errors.js';
import type { SqlQuery, SqlValue } from './sql.builder.js';

/**
 * Операции над одним соединением Turso, доступные бизнес-логике как сервис Effect.
 * Запрос хранит SQL и параметры отдельно: драйвер связывает значения при выполнении.
 */
export interface Database {
    /** Возвращает первую строку или `undefined`, если запрос ничего не нашёл. */
    get<Row extends Record<string, unknown>>(query: SqlQuery): Effect.Effect<Row | undefined, DatabaseError>;
    /** Возвращает все найденные строки. Чтение не занимает очередь записей. */
    all<Row extends Record<string, unknown>>(query: SqlQuery): Effect.Effect<readonly Row[], DatabaseError>;
    /** Выполняет изменяющий запрос. Вне транзакции ждёт своей очереди. */
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

/** Наличие тега отмечает, что этот Effect уже выполняется внутри транзакции. */
interface TransactionContext {
    readonly connection: TursoDatabase;
}

const CurrentTransaction = Context.Service<TransactionContext>('Database.CurrentTransaction');

/**
 * Создаёт Effect-сервис поверх единственного соединения процесса.
 * Один и тот же семафор упорядочивает начало транзакций и отдельные записи: иначе запись
 * вне транзакции могла бы оказаться между её `BEGIN` и `COMMIT`.
 */
export function makeDatabase(connection: TursoDatabase, semaphore: Semaphore.Semaphore): Database {
    // Все вызовы драйвера проходят здесь, чтобы их ошибки имели тип DatabaseError.
    const execute = <Value>(
        operation: string,
        query: SqlQuery,
        call: (parameters: readonly SqlValue[]) => Promise<Value>,
    ): Effect.Effect<Value, DatabaseError> =>
        Effect.tryPromise({
            try: () => call(query.parameters),
            catch: (cause) => new DatabaseError({ operation, cause }),
        });

    /**
     * Вложенный вызов не открывает новый `BEGIN`: текущий Effect уже владеет разрешением
     * семафора, поэтому повторный захват привёл бы к ожиданию самого себя.
     */
    const inTransaction = <Value, Error, Requirements>(
        work: Effect.Effect<Value, Error, Requirements>,
    ): Effect.Effect<Value, Error | DatabaseError, Requirements> =>
        Effect.gen(function* () {
            const current = yield* Effect.serviceOption(CurrentTransaction);
            if (Option.isSome(current)) return yield* work;

            // Разрешение удерживается до завершения COMMIT или ROLLBACK. acquireUseRelease
            // вызывает завершающее действие и при ошибке, и при прерывании work.
            return yield* semaphore.withPermit(
                Effect.acquireUseRelease(
                    Effect.tryPromise({
                        try: () => connection.exec('BEGIN IMMEDIATE'),
                        catch: (cause) => new DatabaseError({ operation: 'BEGIN IMMEDIATE', cause }),
                    }),
                    // Контекст передаётся только работе этой транзакции и её вложенным Effect.
                    () => Effect.provideService(work, CurrentTransaction, { connection }),
                    (_, result) =>
                        Effect.tryPromise({
                            try: () => connection.exec(Exit.isSuccess(result) ? 'COMMIT' : 'ROLLBACK'),
                            catch: (cause) =>
                                new DatabaseError({ operation: Exit.isSuccess(result) ? 'COMMIT' : 'ROLLBACK', cause }),
                        }).pipe(Effect.asVoid),
                ),
            );
        });

    return {
        get: <Row extends Record<string, unknown>>(query: SqlQuery) =>
            execute<Row | undefined>('get', query, (parameters) => connection.get(query.sql, ...parameters)),
        all: <Row extends Record<string, unknown>>(query: SqlQuery) =>
            execute<readonly Row[]>('all', query, (parameters) => connection.all(query.sql, ...parameters)),
        run: (query: SqlQuery) =>
            Effect.gen(function* () {
                const current = yield* Effect.serviceOption(CurrentTransaction);
                const write = execute<DatabaseRunResult>('run', query, (parameters) =>
                    connection.run(query.sql, ...parameters),
                );
                // Внутри транзакции разрешение уже захвачено; отдельная запись ждёт очереди.
                return yield* Option.isSome(current) ? write : semaphore.withPermit(write);
            }),
        transaction: inTransaction,
    };
}
