/**
 * Проведение документов и пометка удаления, собранные из шагов над состоянием документа.
 *
 * Проведение состоит из нескольких изменений, которые разные действия выполняют в разных
 * сочетаниях: `post` проводит документ, `unpost` и пометка удаления отменяют проведение,
 * `save` проведённого документа проводит его заново. Каждое изменение описано одним шагом —
 * функцией от состояния документа к новому состоянию, — а правила «провести» и «отменить
 * проведение» собраны из шагов один раз. Поэтому политики записи подключаются к составным
 * шагам, а не к каждому действию. Журнал сюда не подключается: его строку пишет диспетчер,
 * сравнивая запись до и после всего действия. Шаг, меняющий признак документа, сам обновляет
 * запись в состоянии: цепочке не нужно перечитывать документ из базы между шагами.
 *
 * Простые шаги не экспортируются: у них есть предусловия, которые соблюдают только составные
 * шаги. Например, запись строк регистров добавляет строки к существующим и перед ней нужно
 * удалить прежние движения документа.
 */
import { Effect, flow, pipe, Schema } from 'effect';
import { Database } from '../database/database.effect.js';
import { insert, remove, update, type SqlValue } from '../database/sql.builder.js';
import type { ObjectDescription, RegisterMovements } from '../metadata/descriptions.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { fieldsSchema } from '../metadata/schema.js';
import type { ActionContext, ActionDispatcher } from './action-context.js';
import { DataValidationError } from './data.errors.js';
import { loadRecord, sqlValue, tableName, validated, type RecordValue } from './records.js';
import { readOnlyDatabase } from './read-only-database.js';

/** Описание справочника или документа и его запись с табличными частями в том виде, как её возвращает `get`. */
export interface DocumentState {
    readonly description: ObjectDescription;
    readonly record: RecordValue;
}

/**
 * Сервисы, которые нужны шагам. `ActionContext` и `ActionDispatcher` требуются обработчику
 * проведения: он выполняется внутри действия и может вызывать вложенные действия.
 */
type PostingRequirements = Database | Metadata | ActionContext | ActionDispatcher;

/** Шаг проведения. Ошибка обработчика проведения конфигурации не типизирована, поэтому ошибка шага — `unknown`. */
type Step = (state: DocumentState) => Effect.Effect<DocumentState, unknown, PostingRequirements>;

/**
 * Выполняет шаг, только если состояние удовлетворяет условию, иначе передаёт состояние дальше.
 * `Effect.when` здесь не подходит: он возвращает `Option`, и следующий шаг не получил бы состояние.
 */
function when(predicate: (state: DocumentState) => boolean, step: Step): Step {
    return (state) => predicate(state) ? step(state) : Effect.succeed(state);
}

/** Меняет колонки записи в базе и в состоянии одинаково, чтобы состояние оставалось актуальным без чтения. */
function setValues(state: DocumentState, values: Readonly<Record<string, SqlValue>>, record: RecordValue): Effect.Effect<DocumentState, unknown, Database> {
    return Effect.gen(function* () {
        const database = yield* Database;
        yield* database.run(update(tableName(state.description), values, [{ column: 'guid', operator: '=', value: state.record['guid'] as string }]));
        return { description: state.description, record: { ...state.record, ...record } };
    });
}

const guidOf = (state: DocumentState): string => state.record['guid'] as string;

/** Отклоняет проведение документа с пометкой удаления: такой документ не должен влиять на обороты. */
const ensureNotDeleted: Step = (state) => state.record['deletedAt'] === null
    ? Effect.succeed(state)
    : Effect.fail(new DataValidationError({ message: 'Документ помечен на удаление, провести его нельзя', fields: ['payload.guid'] }));

/** Устанавливает или снимает признак проведения. */
const setPosted = (posted: boolean): Step => (state) => setValues(state, { posted: posted ? 1 : 0 }, { posted });

/** Устанавливает пометку удаления текущим временем или снимает её. */
const setDeletedAt = (marked: boolean): Step => (state) => {
    const deletedAt = marked ? new Date().toISOString() : null;
    return setValues(state, { deletedAt }, { deletedAt });
};

/**
 * Удаляет строки документа во всех регистрах конфигурации, а не только в тех, куда пишет
 * текущий обработчик проведения: после изменения данных документа обработчик может перестать
 * писать в регистр, и старые строки остались бы в нём.
 */
const removeMovements: Step = (state) => Effect.gen(function* () {
    const database = yield* Database;
    const metadata = yield* Metadata;
    for (const register of metadata.objects.filter((object) => object.kind === 'register')) {
        yield* database.run(remove(tableName(register), [
            { column: 'recorderDocument', operator: '=', value: state.description.name },
            { column: 'recorderGuid', operator: '=', value: guidOf(state) },
        ]));
    }
    return state;
});

/**
 * Записывает строки, которые вернул обработчик проведения. Строки проверяются по описанию
 * регистра так же, как входные данные записи; ошибка отменяет проведение вместе с транзакцией.
 * Регистратор и номер строки заполняет платформа, период по умолчанию равен дате документа.
 * Номера строк начинаются с единицы, поэтому прежние движения документа должны быть удалены.
 */
const writeMovements: Step = (state) => Effect.gen(function* () {
    const { description, record } = state;
    if (description.posting === null) return state;
    const database = yield* Database;
    const metadata = yield* Metadata;
    // Описание хранит обработчики разных документов; вызов допустим с записью этого документа.
    const result = description.posting(record as never);
    if (!Effect.isEffect(result)) return yield* Effect.die(new Error('Обработчик проведения должен вернуть Effect'));
    const groups = yield* Effect.provideService(result as Effect.Effect<unknown, unknown, PostingRequirements>, Database, readOnlyDatabase(database));
    if (!Array.isArray(groups)) return yield* Effect.die(new Error('Обработчик проведения должен вернуть список движений'));
    // Номера строк сквозные внутри регистра, даже если обработчик вернул для него несколько групп.
    const lineNumbers = new Map<string, number>();
    for (const group of groups as ReadonlyArray<RegisterMovements>) {
        const register = metadata.find('register', group.register);
        if (register === undefined) return yield* Effect.die(new Error(`Регистр «${group.register}» не найден в конфигурации`));
        const fields = register.fields.filter((field) => !field.managed);
        const rows = group.rows.map((row) => ({ ...row, period: row['period'] ?? record['date'] }));
        const checked = yield* validated(Schema.Array(fieldsSchema(fields)), rows, `проведение.${register.name}`) as Effect.Effect<ReadonlyArray<RecordValue>, DataValidationError>;
        for (const row of checked) {
            const lineNumber = (lineNumbers.get(register.name) ?? 0) + 1;
            lineNumbers.set(register.name, lineNumber);
            const values: Record<string, SqlValue> = { recorderDocument: description.name, recorderGuid: guidOf(state), lineNumber };
            for (const field of fields) values[field.name] = sqlValue(row[field.name]);
            yield* database.run(insert(tableName(register), values));
        }
    }
    return state;
});

/**
 * Перечитывает запись из базы. Нужен после обработчика проведения: через вложенные действия
 * он может изменить сам документ, и состояние перестало бы совпадать с базой.
 */
const reload: Step = (state) => Effect.map(loadRecord(state.description, guidOf(state)), (record) => ({ description: state.description, record }));

/** Читает запись и начинает цепочку шагов; отсутствующая запись даёт 404. */
function load(description: ObjectDescription, guid: string): Effect.Effect<DocumentState, unknown, Database> {
    return Effect.map(loadRecord(description, guid), (record) => ({ description, record }));
}

/**
 * Проводит документ: ставит признак проведения и заменяет его движения строками обработчика.
 * Обработчик получает запись уже с признаком проведения, как она будет видна после действия.
 * Повторное проведение не дублирует движения. Документ с пометкой удаления не проводится (400).
 */
export const postDocument: Step = flow(
    ensureNotDeleted,
    Effect.flatMap(setPosted(true)),
    Effect.flatMap(removeMovements),
    Effect.flatMap(writeMovements),
    Effect.flatMap(reload),
);

/** Отменяет проведение: удаляет движения документа и снимает признак проведения. */
export const unpostDocument: Step = flow(
    removeMovements,
    Effect.flatMap(setPosted(false)),
);

/** Действие `post`: проводит документ и возвращает его запись. */
export function post(description: ObjectDescription, guid: string): Effect.Effect<RecordValue, unknown, PostingRequirements> {
    return pipe(load(description, guid), Effect.flatMap(postDocument), Effect.map((state) => state.record));
}

/** Действие `unpost`: отменяет проведение документа и возвращает его запись. */
export function unpost(description: ObjectDescription, guid: string): Effect.Effect<RecordValue, unknown, PostingRequirements> {
    return pipe(load(description, guid), Effect.flatMap(unpostDocument), Effect.map((state) => state.record));
}

/**
 * Действия `markDeleted` и `unmarkDeleted` справочника или документа. Пометка проведённого
 * документа отменяет его проведение: помеченный документ не должен влиять на обороты регистров.
 * Снятие пометки документ не проводит, это делает отдельное действие `post`.
 */
export function markDeleted(description: ObjectDescription, guid: string, marked: boolean): Effect.Effect<RecordValue, unknown, PostingRequirements> {
    return pipe(
        load(description, guid),
        Effect.flatMap(when((state) => marked && state.record['posted'] === true, unpostDocument)),
        Effect.flatMap(setDeletedAt(marked)),
        Effect.map((state) => state.record),
    );
}

/**
 * Завершает действие `save`: читает записанную запись и, если документ проведён, проводит его
 * заново, чтобы движения соответствовали новым данным. Вызывается после записи полей
 * и табличных частей в той же транзакции.
 */
export function afterSave(description: ObjectDescription, guid: string): Effect.Effect<RecordValue, unknown, PostingRequirements> {
    return pipe(
        load(description, guid),
        Effect.flatMap(when((state) => state.record['posted'] === true, postDocument)),
        Effect.map((state) => state.record),
    );
}
