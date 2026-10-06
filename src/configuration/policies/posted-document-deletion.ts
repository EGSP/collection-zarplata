/** Запрещает помечать проведённый документ на удаление до отмены проведения. */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import type { Policy } from '../../server/metadata/index.js';

/** Другие действия документа эта политика не ограничивает. */
export function preventPostedDocumentDeletion<Record extends { readonly posted: boolean }>(): Policy<Record> {
    return {
        name: 'posted-document-deletion',
        markDeleted: ({ record }) => record.posted
            ? Effect.fail(new DataPolicyError({ message: 'Сначала отмените проведение документа, затем пометьте его на удаление' }))
            : Effect.void,
    };
}
