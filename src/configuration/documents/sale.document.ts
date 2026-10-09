/**
 * Продажа: товары, проданные в смену. Сумма продажи хранится вычисляемым полем шапки: по ней
 * возврат проверяет свой предел, и отдельный регистр для этого не нужен.
 *
 * Продажа может быть оформлена из отвеса действием «Продажа» отвеса. Тогда она ссылается на него
 * как на основание, но остаётся самостоятельным документом: товары в неё скопированы, и её
 * изменение отвес не меняет.
 */
import { document, formula, type ObjectTarget } from '../../server/metadata/index.js';
import { OpenShift } from '../form-elements/open-shift.form-element.js';
import { SaleBasis } from '../form-elements/sale-basis.form-element.js';
import { Goods } from '../goods.js';
import { Shift } from './shift.document.js';
import { Weighing } from './weighing.document.js';

/**
 * Основание на форме скрыто и показано элементом `SaleBasis` ссылкой: его заполняет только
 * действие отвеса, и поле ввода позволило бы привязать продажу к чужому отвесу. Флажок «Проведён»
 * скрыт: проведение показывает отметка в заголовке формы.
 */
export const Sale = document('sale')
    .title('Продажа')
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    // Отвес ссылается на продажу в строках товаров, поэтому файлы импортируют друг друга по кругу.
    // Тип результата указан явно: иначе тип продажи выводился бы через тип отвеса и обратно.
    .field('basis', (field) => field.reference((): ObjectTarget => Weighing).title('Основание'))
    .field('amount', (field) => field.money().title('Сумма').required().computed(formula.sum('goods', 'total')))
    .tablePart('goods', (part) => part.title('Товары').include(Goods))
    .listTableParts(['goods'])
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Продажа', ['number', 'date', 'shift', OpenShift, SaleBasis])
        .group('Товары', ['goods', 'amount'])
        .hide('basis')
        .hide('posted'));
