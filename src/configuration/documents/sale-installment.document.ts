/**
 * Рассрочка по продаже: часть оплаты продажи, которую покупатель вносит взносами. Оформляется
 * на сумму строк оплаты продажи со способом «Рассрочка» действием продажи «Оформить рассрочку».
 * Товаров у документа нет: они записаны в продаже и входят в её сумму, а сумма рассрочки вводится.
 *
 * Отдельный документ, а не поля рассрочки в строке оплаты: так продажа не усложняется.
 *
 * Поля шапки, взносы, политика, проведение и действия «Внести» и «Закрыть» заданы общим описанием
 * рассрочек в `installments.ts`.
 */
import { movements } from '../../server/metadata/index.js';
import { installmentDocument } from '../installments.js';
import { SaleInstallments } from '../registers/sale-installments.register.js';
import { Sale } from './sale.document.js';

/**
 * Проведённая рассрочка записывает свою сумму с минусом в регистр «Рассрочки по продажам»:
 * так итог по продаже показывает сумму, на которую рассрочка ещё не оформлена. Превысить сумму
 * строк оплаты «Рассрочка» не даёт ограничение этого регистра, а не политика документа.
 */
export const SaleInstallment = installmentDocument('saleInstallment', 'Рассрочка по продаже', (base) => base
    .field('sale', (field) => field.reference(Sale).title('Продажа').required())
    .field('amount', (field) => field.money().title('Сумма').minimum(1).required()),
// Вычитание из нуля, а не унарный минус: так сумма записана в том же виде, что у остальных движений с минусом.
(record) => [movements(SaleInstallments, [{ sale: record.sale, amount: 0 - record.amount }])])
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    .form((form) => form
        .group('Рассрочка', ['number', 'date', 'sale', 'type', 'shift', 'person', 'responsibleEmployee', 'amount'])
        .group('Взносы', ['payments', 'balance'])
        .hide('closedAt')
        .hide('posted'));
