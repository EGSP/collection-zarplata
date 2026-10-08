/**
 * Пробный документ для проверки платформы, пока в конфигурации нет прикладных документов.
 * Ссылается на пробный справочник в шапке и в табличной части, при проведении записывает
 * строки табличной части в пробный регистр. На его форме стоят пробные собственные элементы:
 * блок «Итого» под табличной частью и поле ввода комментария с кнопкой. Удаляется, когда
 * появятся настоящие документы.
 */
import { Effect } from 'effect';
import { document, movements } from '../../server/metadata/index.js';
import { Sample } from '../catalogs/sample.catalog.js';
import { SampleComment } from '../form-elements/sample-comment.form-element.js';
import { SampleTotal } from '../form-elements/sample-total.form-element.js';
import { SampleRegister } from '../registers/sample.register.js';
import { closedPeriodByDocumentDate } from '../policies/closed-period.js';
import { preventPostedDocumentDeletion } from '../policies/posted-document-deletion.js';

export const SampleDocument = document('sample')
    .title('Пробный документ')
    .field('item', (field) => field.reference(Sample).title('Элемент справочника').required())
    .field('comment', (field) => field.string().title('Комментарий').maximumLength(500))
    .tablePart('lines', (part) => part
        .title('Строки')
        .field('item', (field) => field.reference(Sample).title('Элемент справочника').required())
        .field('quantity', (field) => field.number().title('Количество').minimum(0).required())
        .field('amount', (field) => field.money().title('Сумма').minimum(0).required()))
    // Элемент ставится на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе строки оказались бы над ней.
    .form((form) => form
        .group('Основное', ['number', 'date', 'posted', 'item', 'comment'])
        .group('Строки и итог', ['lines', SampleTotal])
        .input('comment', SampleComment))
    .policy(closedPeriodByDocumentDate())
    .policy(preventPostedDocumentDeletion())
    .posting((record) => Effect.succeed([
        movements(SampleRegister, record.lines.map((line) => ({ item: line.item, quantity: line.quantity, amount: line.amount }))),
    ]));
