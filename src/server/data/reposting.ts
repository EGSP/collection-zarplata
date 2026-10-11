/**
 * Перепроведение всех проведённых документов конфигурации одной операцией.
 *
 * Операция нужна после изменения конфигурации: документ начал записывать движения, которых
 * раньше не было, либо перестал записывать прежние. Движения существующих документов при этом
 * не меняются сами: их записывает только проведение. Документы проводятся заново в порядке дат,
 * как они проводились бы при обычной работе, и каждый проходит проверку ограничений итога.
 *
 * Политики проведения не вызываются, как и при записи проведённого документа: операция
 * не меняет данные документов, а приводит движения в соответствие с ними. Иначе, например,
 * закрытый период запретил бы перепроведение прошлых документов.
 */
import { Effect } from 'effect';
import type { CurrentUserRights } from '../authorization/current-user-rights.js';
import { Database } from '../database/database.effect.js';
import { select } from '../database/sql.builder.js';
import type { ObjectDescription } from '../metadata/descriptions.js';
import { Metadata } from '../metadata/metadata.effect.js';
import { writeJournal } from '../journal/journal.js';
import { formatDateTime } from '../ui/value-format.js';
import type { ActionContext, ActionDispatcher } from './action-context.js';
import { DataPolicyError, DataValidationError } from './data.errors.js';
import { post } from './posting.js';
import { tableName } from './records.js';

/** Цель операции в запросе и в журнале. Вид `platform` не совпадает ни с одним видом объектов конфигурации. */
export const documentsTarget = { kind: 'platform', name: 'documents' } as const;

/** Проведённый документ в очереди перепроведения. */
interface PostedDocument {
    readonly description: ObjectDescription;
    readonly guid: string;
    readonly number: string;
    readonly date: string;
}

/**
 * Проводит заново все проведённые документы и возвращает их число. Отказ ограничения итога
 * и неверные строки движений останавливают операцию; текст ошибки начинается с названия
 * документа, на котором она возникла. Вызывающий код выполняет операцию в транзакции:
 * при ошибке откатываются движения всех уже перепроведённых документов.
 */
export const repostDocuments: Effect.Effect<{ readonly documents: number }, unknown, Database | Metadata | ActionContext | ActionDispatcher | CurrentUserRights> = Effect.gen(function* () {
    const occurredAt = new Date().toISOString();
    const database = yield* Database;
    const metadata = yield* Metadata;
    const queue: PostedDocument[] = [];
    for (const description of metadata.objects) {
        if (description.kind !== 'document') continue;
        const rows = yield* database.all<{ guid: string; number: string; date: string }>(select(tableName(description), {
            columns: ['guid', 'number', 'date'],
            where: [{ column: 'posted', operator: '=', value: 1 }],
        }));
        queue.push(...rows.map((row) => ({ description, ...row })));
    }
    // При равных датах порядок задаёт guid: UUIDv7 упорядочен по времени создания документа.
    queue.sort((left, right) => left.date.localeCompare(right.date) || left.guid.localeCompare(right.guid));
    for (const document of queue) {
        const title = `${document.description.title} № ${document.number} от ${formatDateTime(document.date)}`;
        yield* post(document.description, document.guid).pipe(Effect.mapError((error) => {
            if (error instanceof DataPolicyError) return new DataPolicyError({ message: `${title}: ${error.message}` });
            if (error instanceof DataValidationError) return new DataValidationError({ message: `${title}: ${error.message}`, fields: error.fields });
            return error;
        }));
    }
    yield* writeJournal({ occurredAt, target: { ...documentsTarget, guid: null }, action: 'repost', changes: null });
    return { documents: queue.length };
});
