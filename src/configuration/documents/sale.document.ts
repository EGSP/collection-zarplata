/**
 * Продажа: товары, проданные в смену, и их оплата. Сумма продажи хранится вычисляемым полем шапки:
 * по ней работают списки. Проведённая продажа записывает сумму в регистр «Продажи» со своей сменой;
 * по итогу регистра проверяется предел возврата. Оплаты деньгами она записывает в регистр
 * «Поступления денег» по способам, а сумму оплат способом «Рассрочка» в регистр «Рассрочки
 * по продажам»: на неё оформляются рассрочки по продаже.
 *
 * Продажа может быть оформлена из отвеса действием «Продажа» отвеса. Тогда она ссылается на него
 * как на основание, но остаётся самостоятельным документом: товары в неё скопированы, и её
 * изменение отвес не меняет.
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { query } from '../../server/database/sql.builder.js';
import { Database } from '../../server/database/database.effect.js';
import { document, formula, movements, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { Goods } from '../goods.js';
import { rubles } from '../money.js';
import { cash, installmentMethod, paymentColumns, paymentMethods } from '../payments.js';
import { MoneyReceipts } from '../registers/money-receipts.register.js';
import { SaleInstallments } from '../registers/sale-installments.register.js';
import { Sales } from '../registers/sales.register.js';
import { Shift } from './shift.document.js';
import { Weighing } from './weighing.document.js';

/** Способ оплаты продажи, при котором оплат несколько и у каждой свой способ. */
const complexPayment = 'Сложная';

/**
 * Описание без политики и действия. Они читают запись продажи, а ссылка на `Sale` из его же
 * объявления не дала бы вывести тип.
 *
 * Способ оплаты хранится полем, а не выводится из числа строк оплат: сложная оплата из одной
 * строки неотличима от простой, и форма не знала бы, что показать. Простая оплата тоже хранится
 * строкой части «Оплаты», а не суммой в шапке: движения и правила читают оплаты одинаково при
 * любом способе.
 *
 * Строка оплаты допускает способ «Рассрочка»: деньги по ней не приняты, на её сумму оформляется
 * рассрочка по продаже. Способом оплаты всей продажи «Рассрочка» быть не может.
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
    .tablePart('payments', (part) => part.title('Оплаты').include(paymentColumns([...paymentMethods, installmentMethod])))
    .listTableParts(['goods']);

type SaleRecord = RecordOf<typeof sale>;

const rejected = (message: string) => Effect.fail(new DataPolicyError({ message }));

/** Оплата, по которой деньги не приняты: на её сумму оформляется рассрочка по продаже. */
const byInstallment = (payment: SaleRecord['payments'][number]) => payment.method === installmentMethod;

/** Сумма оплат способом «Рассрочка»: на неё оформляются рассрочки по продаже. */
const installmentAmount = (record: SaleRecord) => record.payments.filter(byInstallment).reduce((total, payment) => total + payment.amount, 0);

/**
 * Проверяет оплаты продажи при записи и проведении (раздел «Правила учёта»).
 *
 * Оплаты складываются из строк, а не берутся из поля «Оплачено»: у продажи, записанной до
 * появления оплат, это поле пусто. Простой способ допускает не больше одной оплаты, а не ровно
 * одну: у продажи с нулевой суммой оплат нет, потому что сумма оплаты больше нуля.
 *
 * Способ «Рассрочка» закрывает только часть сложной оплаты. У такой строки «Куда оплачено» пусто:
 * деньги по ней не приняты и придут взносами рассрочки.
 */
const checkPayments = (record: SaleRecord) => {
    const mode = record.paymentMode;
    for (const [index, payment] of record.payments.entries()) {
        if (!byInstallment(payment)) continue;
        const place = `Строка оплаты ${index + 1}`;
        if (mode !== complexPayment) return rejected(`${place}: способ «${installmentMethod}» допустим только при способе оплаты продажи «${complexPayment}»`);
        // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
        if ((payment.receiver ?? null) !== null) return rejected(`${place}: у оплаты способом «${installmentMethod}» «Куда оплачено» не заполняется`);
    }
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
 * Правила оплат действуют при любой записи и при проведении: продажа, оплаты которой не сходятся
 * с суммой товаров, не записывается даже непроведённой. Иначе ошибку в оплате продавец увидел бы
 * только при проведении, когда покупатель уже ушёл. Правило простого способа проверяется здесь,
 * а не только элементом формы: иначе запрос через API записал бы продажу «Наличные» с двумя
 * строками оплат.
 */
const salePayments: Policy<SaleRecord> = {
    name: 'sale-payments',
    save: ({ proposedRecord }) => checkPayments(proposedRecord),
    post: ({ document }) => checkPayments(document),
};

const target = { kind: 'document', name: 'sale' };

/**
 * Основание на форме скрыто и показано элементом `SaleBasis` ссылкой: его заполняет только
 * действие отвеса, и поле ввода позволило бы привязать продажу к чужому отвесу. Флажок «Проведён»
 * скрыт: проведение показывает отметка в заголовке формы.
 *
 * Способ оплаты на форме выбирает элемент `SalePaymentMode`, оплаты показывает элемент
 * `SalePayments`: при простом способе это сумма и «Куда оплачено», при сложном полная таблица.
 *
 * Неоформленную сумму рассрочки показывает элемент `SaleInstallmentArrangement`; он же выводит
 * кнопку действия «Оформить рассрочку» и передаёт ему `guid` продажи. Стандартную кнопку действия
 * элемент скрывает: её окно потребовало бы выбрать продажу.
 *
 * Рассрочку создаёт действие на сервере, а не форма новой рассрочки: сумма берётся из итога
 * регистра в той же транзакции, и форма не может подставить устаревшую. Рассрочка записывается
 * вложенным `save`, а оно проверяется по правам того же пользователя, поэтому пользователю нужны
 * права на действие, на чтение продажи и на запись рассрочки по продаже.
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
    .action('createInstallment', (action) => action
        .title('Оформить рассрочку')
        .input((input) => input.field('sale', (field) => field.reference(sale).title('Продажа').required()))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.sale } })) as SaleRecord;
            // Итог есть только у проведённой продажи: непроведённая движений не записала.
            if (!record.posted) return yield* rejected('Продажа не проведена: сначала проведите её, чтобы оформить рассрочку');
            // Итог регистра по продаже считается запросом в транзакции действия. Запрос собран
            // конструктором SQL, а не функцией итогов платформы: её модуль тянет серверный код
            // в проверку типов клиента, который читает тип продажи.
            const database = yield* Database;
            const total = yield* database.get(query(SaleInstallments).sums({
                groupBy: [],
                sums: ['amount'],
                where: [{ column: 'sale', operator: '=', value: record.guid }],
            }));
            const amount = total?.amount ?? 0;
            if (amount <= 0) return yield* rejected('По продаже нет суммы, на которую рассрочка ещё не оформлена');
            // Рассрочка относится к смене, в которую её оформили, а не к смене продажи: продажа уже
            // записала свою сумму в свою смену, а долг покупателя выдаёт смена, оформившая рассрочку.
            const shift = yield* database.get(query(Shift).select({
                columns: ['guid'],
                where: [{ column: 'closedAt', operator: '=', value: null }],
                limit: 1,
            }));
            if (shift === undefined) return yield* rejected('Нет открытой смены: откройте смену, чтобы оформить рассрочку');
            // Рассрочка создаётся непроведённой: тип, физическое лицо и ответственного продавец
            // заполняет в ней сам, и до проведения итог регистра она не уменьшает.
            return yield* dispatcher.execute({
                target: { kind: 'document', name: 'saleInstallment' }, action: 'save',
                payload: { fields: { date: new Date().toISOString(), sale: record.guid, shift: shift.guid, amount, payments: [] } },
            });
        })))
    // Проведение объявлено последним: его обработчик ссылается на регистр «Продажи», а тот читает
    // продажу в тексте отказа. У последнего вызова цепочки компилятор берёт тип результата без
    // разбора обработчика, поэтому тип продажи не выводится через тип регистра и обратно.
    .posting((record) => Effect.succeed([
        movements(Sales, [{ sale: record.guid, shift: record.shift, amount: record.amount }]),
        // Движение на каждую оплату деньгами со сменой продажи: итог смены по способу складывается из них.
        movements(MoneyReceipts, record.payments.filter((payment) => !byInstallment(payment)).map((payment) => ({ shift: record.shift, method: payment.method, amount: payment.amount }))),
        // Оплаты способом «Рассрочка» записаны одной суммой: рассрочки оформляются на продажу, а не на строку.
        movements(SaleInstallments, installmentAmount(record) > 0 ? [{ sale: record.guid, amount: installmentAmount(record) }] : []),
    ]));
