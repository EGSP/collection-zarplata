/**
 * Рассрочка: товар, который покупатель оплачивает взносами. Ведётся отдельно от продаж: продажей
 * не становится и возвратом не уменьшается. Сумма хранится вычисляемым полем шапки и равна сумме
 * товаров.
 *
 * Поля шапки, взносы, политика, проведение и действия «Внести» и «Закрыть» заданы общим описанием
 * рассрочек в `installments.ts`.
 */
import { formula } from '../../server/metadata/index.js';
import { Goods } from '../goods.js';
import { installmentDocument } from '../installments.js';

/**
 * Состояние показывает элемент `InstallmentState`; он же выводит кнопки действий «Внести»
 * и «Закрыть» и передаёт им `guid` рассрочки. Стандартные кнопки этих действий элемент скрывает:
 * их окно потребовало бы выбрать рассрочку.
 */
export const Installment = installmentDocument('installment', 'Рассрочка', (base) => base
    .field('amount', (field) => field.money().title('Сумма').required().computed(formula.sum('goods', 'total')))
    .tablePart('goods', (part) => part.title('Товары').include(Goods))
    .listTableParts(['goods']))
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Рассрочка', ['number', 'date', 'type', 'shift', 'person', 'responsibleEmployee'])
        .group('Товары', ['goods', 'amount'])
        .group('Взносы', ['payments', 'balance'])
        .hide('closedAt')
        .hide('posted'));
