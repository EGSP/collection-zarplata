/**
 * Продажа: товары, проданные в смену, и их оплата. Сумма продажи хранится вычисляемым полем шапки:
 * по ней работают списки. Проведённая продажа записывает сумму в регистр «Продажи» со своей сменой;
 * по итогу регистра проверяется предел возврата. Оплаты она записывает в регистр «Поступления
 * денег» по способам.
 *
 * Продажа может быть оформлена из отвеса действием «Продажа» отвеса. Тогда она ссылается на него
 * как на основание, но остаётся самостоятельным документом: товары в неё скопированы, и её
 * изменение отвес не меняет.
 */
import { Effect } from 'effect';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { document, formula, movements, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { Goods } from '../goods.js';
import { rubles } from '../money.js';
import { cash, paymentMethods, Payments } from '../payments.js';
import { MoneyReceipts } from '../registers/money-receipts.register.js';
import { Sales } from '../registers/sales.register.js';
import { Shift } from './shift.document.js';
import { Weighing } from './weighing.document.js';

/** Способ оплаты продажи, при котором оплат несколько и у каждой свой способ. */
const complexPayment = 'Сложная';

/**
 * Описание без политики. Политика читает запись продажи, а ссылка на `Sale` из его же объявления
 * не дала бы вывести тип.
 *
 * Способ оплаты хранится полем, а не выводится из числа строк оплат: сложная оплата из одной
 * строки неотличима от простой, и форма не знала бы, что показать. Простая оплата тоже хранится
 * строкой части «Оплаты», а не суммой в шапке: движения и правила читают оплаты одинаково при
 * любом способе.
 */
const sale = document('sale')
    .title('Продажа')
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    // Отвес ссылается на продажу в строках товаров, поэтому файлы импортируют друг друга по кругу.
    // Тип результата указан явно: иначе тип продажи выводился бы через тип отвеса и обратно.
    .field('basis', (field) => field.reference((): ObjectTarget => Weighing).title('Основание'))
    .field('amount', (field) => field.money().title('Сумма').required().computed(formula.sum('goods', 'total')))
    .field('paymentMode', (field) => field.string().title('Способ оплаты').choices([...paymentMethods, complexPayment]).initial(cash).required())
    .field('paid', (field) => field.money().title('Оплачено').required().computed(formula.sum('payments', 'amount')))
    .tablePart('goods', (part) => part.title('Товары').include(Goods))
    .tablePart('payments', (part) => part.title('Оплаты').include(Payments))
    .listTableParts(['goods']);

type SaleRecord = RecordOf<typeof sale>;

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/**
 * Проверяет оплаты продажи, которая проведена или проводится (раздел «Правила учёта»).
 *
 * Оплаты складываются из строк, а не берутся из поля «Оплачено»: у продажи, записанной до
 * появления оплат, это поле пусто. Простой способ допускает не больше одной оплаты, а не ровно
 * одну: у продажи с нулевой суммой оплат нет, потому что сумма оплаты больше нуля.
 */
const checkPayments = (record: SaleRecord) => {
    const mode = record.paymentMode;
    if (mode !== complexPayment) {
        if (record.payments.length > 1) return rejected(`При способе оплаты «${mode}» у продажи одна оплата, а указано ${record.payments.length}`);
        const method = record.payments[0]?.method ?? mode;
        if (method !== mode) return rejected(`Способ оплаты «${method}» в строке оплаты не совпадает со способом оплаты продажи «${mode}»`);
    }
    const paid = record.payments.reduce((total, payment) => total + payment.amount, 0);
    if (paid < record.amount) return rejected(`Оплаты меньше суммы продажи на ${rubles(record.amount - paid)}`);
    if (paid > record.amount) return rejected(`Оплаты больше суммы продажи на ${rubles(paid - record.amount)}`);
    return Effect.void;
};

/**
 * Правила оплат действуют при проведении и при записи проведённой продажи; непроведённая
 * записывается без них, как черновик. Правило простого способа проверяется здесь, а не только
 * элементом формы: иначе запрос через API записал бы продажу «Наличные» с двумя строками оплат.
 */
const salePayments: Policy<SaleRecord> = {
    name: 'sale-payments',
    save: ({ proposedRecord }) => proposedRecord.posted ? checkPayments(proposedRecord) : Effect.void,
    post: ({ document }) => checkPayments(document),
};

/**
 * Основание на форме скрыто и показано элементом `SaleBasis` ссылкой: его заполняет только
 * действие отвеса, и поле ввода позволило бы привязать продажу к чужому отвесу. Флажок «Проведён»
 * скрыт: проведение показывает отметка в заголовке формы.
 *
 * Способ оплаты на форме выбирает элемент `SalePaymentMode`, оплаты показывает элемент
 * `SalePayments`: при простом способе это сумма и «Куда оплачено», при сложном полная таблица.
 */
export const Sale = sale
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Продажа', ['number', 'date', 'shift'])
        .group('Товары', ['goods', 'amount'])
        .group('Оплата', ['paymentMode', 'payments', 'paid'])
        .hide('basis')
        .hide('posted'))
    .policy(salePayments)
    .posting((record) => Effect.succeed([
        movements(Sales, [{ sale: record.guid, shift: record.shift, amount: record.amount }]),
        // Движение на каждую оплату со сменой продажи: итог смены по способу складывается из них.
        movements(MoneyReceipts, record.payments.map((payment) => ({ shift: record.shift, method: payment.method, amount: payment.amount }))),
    ]));
