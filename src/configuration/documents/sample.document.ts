/**
 * Пробный документ для проверки платформы, пока в конфигурации нет прикладных документов.
 * Ссылается на пробный справочник в шапке и в табличной части, а в шапке ещё и на пробный
 * справочник с представлением по ссылке, при проведении записывает
 * строки табличной части в пробный регистр. На его форме стоят пробные собственные элементы:
 * блок «Итого» под табличной частью, поле ввода комментария с кнопкой и элемент, который делает
 * форму документа с комментарием недоступной для изменения. Удаляется, когда появятся настоящие
 * документы.
 */
import { SampleLines } from '../sample-lines.js';
import { Effect } from 'effect';
import { document, formula, movements } from '../../server/metadata/index.js';
import { SampleDelegate } from '../catalogs/sample-delegate.catalog.js';
import { Sample } from '../catalogs/sample.catalog.js';
import { SampleComment } from '../form-elements/sample-comment.form-element.js';
import { SampleLock } from '../form-elements/sample-lock.form-element.js';
import { SampleTotal } from '../form-elements/sample-total.form-element.js';
import { SampleRegister } from '../registers/sample.register.js';
import { closedPeriodByDocumentDate } from '../policies/closed-period.js';
import { preventPostedDocumentDeletion } from '../policies/posted-document-deletion.js';

/** Пробный документ с вычислениями, общими строками и составным представлением. */
export const SampleDocument = document('sample')
    .title('Пробный документ')
    .field('item', (field) => field.reference(Sample).title('Элемент справочника').required())
    .field('delegate', (field) => field.reference(SampleDelegate).title('Элемент с представлением по ссылке'))
    .field('comment', (field) => field.string().title('Комментарий').maximumLength(500))
    .field('total', (field) => field.money().title('Итого после скидки').required().computed(formula.sum('lines', 'netAmount')))
    .field('discount', (field) => field.number().title('Скидка шапки, %').suggestions(Sample, 'percentage'))
    .tablePart('lines', (part) => part.title('Строки').include(SampleLines))
    .listTableParts(['lines'])
    .presentation([{ text: '№ ' }, { field: 'number', format: 'number' }, { text: ' от ' }, { field: 'date', format: 'date' }, { text: ', ' }, { tablePart: 'lines', field: 'item' }])
    .action('acceptLines', (action) => action.title('Принять строки').input((input) => input.tablePart('lines', (part) => part.title('Строки действия').include(SampleLines))).handle((input) => Effect.succeed(input.lines)))
    // Элемент ставится на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе строки оказались бы над ней.
    .form((form) => form
        .group('Основное', ['number', 'date', 'posted', 'item', 'delegate', 'comment', SampleLock])
        .group('Строки и итог', ['lines', SampleTotal])
        .input('comment', SampleComment))
    .policy(closedPeriodByDocumentDate())
    .policy(preventPostedDocumentDeletion())
    .posting((record) => Effect.succeed([
        movements(SampleRegister, record.lines.map((line) => ({ item: line.item, quantity: line.quantity, amount: line.amount }))),
    ]));
