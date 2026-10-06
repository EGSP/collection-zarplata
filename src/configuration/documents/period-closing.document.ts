/** Проведённая запись устанавливает границу закрытого учётного периода включительно. */
import { document } from '../../server/metadata/index.js';
import { preventPostedDocumentDeletion } from '../policies/posted-document-deletion.js';

/** Дата документа означает оформление закрытия; `closedThrough` задаёт его учётную границу. */
export const PeriodClosing = document('periodClosing')
    .title('Закрытие периода')
    .field('closedThrough', (field) => field.date().title('Закрыто по').required())
    .policy(preventPostedDocumentDeletion());
