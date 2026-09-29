import type { Database as TursoDatabase } from '@tursodatabase/database';
import { Context, Effect, Exit, Option, Semaphore } from 'effect';
import { DatabaseError } from './database.errors.js';
import type { SqlQuery, SqlValue } from './sql.builder.js';

export interface Database {
    get<Row extends Record<string, unknown>>(query: SqlQuery): Effect.Effect<Row | undefined, DatabaseError>;
    all<Row extends Record<string, unknown>>(query: SqlQuery): Effect.Effect<readonly Row[], DatabaseError>;
    run(query: SqlQuery): Effect.Effect<DatabaseRunResult, DatabaseError>;
    transaction<Value, Error, Requirements>(
        work: Effect.Effect<Value, Error, Requirements>,
    ): Effect.Effect<Value, Error | DatabaseError, Requirements>;
}

export interface DatabaseRunResult {
    readonly changes: number;
    readonly lastInsertRowid: number | bigint;
}

export const Database = Context.Service<Database>('Database');

interface TransactionContext {
    readonly connection: TursoDatabase;
}

const CurrentTransaction = Context.Service<TransactionContext>('Database.CurrentTransaction');

/** Создаёт Effect-сервис поверх единственного соединения процесса. */
export function makeDatabase(connection: TursoDatabase, semaphore: Semaphore.Semaphore): Database {
    const execute = <Value>(
        operation: string,
        query: SqlQuery,
        call: (parameters: readonly SqlValue[]) => Promise<Value>,
    ): Effect.Effect<Value, DatabaseError> =>
        Effect.tryPromise({
            try: () => call(query.parameters),
            catch: (cause) => new DatabaseError({ operation, cause }),
        });

    const inTransaction = <Value, Error, Requirements>(
        work: Effect.Effect<Value, Error, Requirements>,
    ): Effect.Effect<Value, Error | DatabaseError, Requirements> =>
        Effect.gen(function* () {
            const current = yield* Effect.serviceOption(CurrentTransaction);
            if (Option.isSome(current)) return yield* work;

            return yield* semaphore.withPermit(
                Effect.acquireUseRelease(
                    Effect.tryPromise({
                        try: () => connection.exec('BEGIN IMMEDIATE'),
                        catch: (cause) => new DatabaseError({ operation: 'BEGIN IMMEDIATE', cause }),
                    }),
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
                return yield* Option.isSome(current) ? write : semaphore.withPermit(write);
            }),
        transaction: inTransaction,
    };
}
