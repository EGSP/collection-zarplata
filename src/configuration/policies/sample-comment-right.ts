/**
 * Пробное правило для проверки прав в политике: комментарий записанного документа меняет только
 * пользователь с правом на собственное действие «Принять строки». Удаляется вместе с пробными объектами.
 */
import { Effect } from 'effect';
import { requireRight } from '../../server/authorization/current-user-rights.js';
import type { Policy } from '../../server/metadata/index.js';
import { Rights } from '../configuration.generated.js';

/**
 * Создание документа с комментарием правило не ограничивает: проверяется только изменение.
 * `Rights` читается внутри обработчика: объект прав строится из модулей объектов и при загрузке
 * модуля документа ещё не готов. Тип политики указан явно: тип `Rights` выводится из типа
 * документа, и без аннотации тип документа зависел бы от самого себя.
 */
export const sampleCommentRight: Policy<{ readonly comment: string | null }> = {
    name: 'sample-comment-right',
    save: ({ existingRecord, proposedRecord }) => Effect.gen(function* () {
        if (existingRecord === null || existingRecord.comment === proposedRecord.comment) return;
        yield* requireRight(Rights.document.sample.actions.acceptLines);
    }),
};
