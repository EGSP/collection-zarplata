/**
 * Пробный документ для проверки платформы, пока в конфигурации нет прикладных документов.
 * Ссылается на пробный справочник в шапке и в табличной части, а в шапке ещё и на пробный
 * справочник с представлением по ссылке, при проведении записывает
 * строки табличной части в пробный регистр. На его форме стоят пробные собственные элементы:
 * блок «Итого» под табличной частью, поле ввода комментария с кнопкой и элемент, который делает
 * форму документа с комментарием недоступной для изменения. Политика `sampleCommentRight` проверяет
 * право пользователя: без права на действие «Принять строки» комментарий записанного документа
 * не меняется. Удаляется, когда появятся настоящие документы.
 */
import { SampleLines } from '../sample-lines.js';
import { Effect } from 'effect';
import { document, formula, movements } from '../../server/metadata/index.js';
import { SampleDelegate } from '../catalogs/sample-delegate.catalog.js';
import { Sample } from '../catalogs/sample.catalog.js';
import { SampleRegister } from '../registers/sample.register.js';
import { closedPeriodByDocumentDate } from '../policies/closed-period.js';
import { sampleCommentRight } from '../policies/sample-comment-right.js';

/** Пробный документ с вычислениями, общими строками и составным представлением. */
export const SampleDocument = document('sample')
    .title('Пробный документ')
    .field('item', (field) => field.reference(Sample).title('Элемент справочника').required())
    .field('delegate', (field) => field.reference(SampleDelegate).title('Элемент с представлением по ссылке'))
    .field('comment', (field) => field.string().title('Комментарий').maximumLength(500))
    .field('total', (field) => field.money().title('Итого после скидки').required().computed(formula.sum('lines', 'netAmount')))
    .field('discount', (field) => field.number().title('Скидка шапки, %').suggestions(Sample, 'percentage'))
    .field('paymentComment', (field) => field.string().title('Примечание к оплате'))
    .field('paymentTotal', (field) => field.money().title('Итого оплаты').required().computed(formula.sum('payments', 'netAmount')))
    .tablePart('payments', (part) => part.title('Оплата')
        .field('method', (field) => field.string().title('Способ оплаты').choices(['Наличные', 'Карта']).initial('Наличные').required())
        .field('amount', (field) => field.money().title('Сумма оплаты').minimum(0).required())
        .field('netAmount', (field) => field.money().title('Учтённая сумма').required().computed(formula.field('amount'))))
    .tablePart('lines', (part) => part.title('Строки').include(SampleLines))
    .listTableParts(['lines'])
    .presentation([{ text: '№ ' }, { field: 'number', format: 'number' }, { text: ' от ' }, { field: 'date', format: 'date' }, { text: ', ' }, { tablePart: 'lines', field: 'item' }])
    .action('acceptLines', (action) => action.title('Принять строки').input((input) => input.tablePart('lines', (part) => part.title('Строки действия').include(SampleLines))).handle((input) => Effect.succeed(input.lines)))
    // Группы идут раньше остальных полей, поэтому шапка собрана в группу перед строками.
    .form((form) => form
        .group('Основное', ['number', 'date', 'posted', 'item', 'delegate', 'comment'])
        .group('Строки и итог', ['lines'])
        .group('Оплата', ['discount', 'payments', 'paymentComment', 'paymentTotal']))
    .policy(closedPeriodByDocumentDate())
    .policy(sampleCommentRight)
    .posting((record) => Effect.succeed([
        movements(SampleRegister, record.lines.map((line) => ({ item: line.item, quantity: line.quantity, amount: line.amount }))),
    ]));
