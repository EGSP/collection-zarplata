/**
 * Функции документа «Рассрочка по продаже». Объявления лежат отдельно от документа, чтобы их
 * сигнатуры можно было импортировать туда, откуда документ недоступен: продажа импортируется
 * рассрочкой, и импорт рассрочки в продажу замкнул бы файлы и выводы их типов в круг.
 *
 * Файл подключает документ (`installments.ts`, `.function('figures', figuresFunction)`), а вызывающий
 * код берёт ссылку `SaleInstallmentFunctions` для `callFunction`. Проверка импортов конфигурации
 * (`scripts/configuration-imports-check.ts`) следит, чтобы файл не входил ни в один круг импортов
 * и не доходил по ним до своего документа.
 */
import { Effect } from 'effect';
import { query } from '../../server/database/sql.builder.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { objectReference, type ActionInputBuilder, type FunctionBuilder, type ObjectTarget, type SignatureOf } from '../../server/metadata/index.js';
import { dayOf } from '../policies/closed-period.js';
import { InstallmentDebts } from '../registers/installment-debts.register.js';

/** Документ рассрочки: основание её движений в регистре «Долги по рассрочкам». */
const installmentTarget = { kind: 'document', name: 'saleInstallment' } as const satisfies ObjectTarget;

/**
 * Суммы одной рассрочки из регистра «Долги по рассрочкам». Все суммы в копейках.
 * Непроведённая рассрочка движений не имеет, и все её суммы равны нулю.
 */
export interface InstallmentFigures {
    readonly installment: string;
    /** Сумма рассрочки: движение самой рассрочки с плюсом. */
    readonly amount: number;
    /** Взносы: движения самой рассрочки с минусом. Это деньги, которые покупатель внёс. */
    readonly paid: number;
    /** Погашения возвратами «В счёт долга»: движения возвратов. Денег они не приносят. */
    readonly refunded: number;
    /** Долг: сумма за вычетом взносов и погашений. Без дня равен полю «Остаток». */
    readonly debt: number;
}

/**
 * Суммы рассрочек на день `date` или текущие (раздел «Правила учёта»). Единственное место, где
 * долг делится на взносы и погашения возвратами: его используют сводка за период, формы продажи
 * и рассрочки и проверки сервера через функцию `figures`.
 *
 * Регистр не различает взносы и погашения ресурсом, поэтому их разделяет регистратор: движения
 * самой рассрочки — её сумма (плюс) и взносы (минус), движения других документов — погашения
 * возвратами. Период движения — дата рассрочки, взноса или возврата, поэтому отбор по дню даёт
 * суммы на конец этого дня. День сравнивается по первым десяти знакам даты, как в сводке.
 */
const installmentFigures = (installments: ReadonlyArray<string>, date: string | null) => Effect.gen(function* () {
    const database = yield* ReadonlyDatabase;
    const guids = [...new Set(installments)];
    const rows = guids.length === 0 ? [] : yield* database.all(query(InstallmentDebts).select({
        columns: ['basis', 'recorder', 'period', 'amount'],
        where: [{ column: 'basis', operator: 'IN', value: guids.map((guid) => objectReference(installmentTarget, guid)) }],
    }));
    const figures = new Map(guids.map((guid) => [guid, { installment: guid, amount: 0, paid: 0, refunded: 0, debt: 0 }]));
    for (const row of rows) {
        if (date !== null && dayOf(row.period) > date) continue;
        const own = figures.get(row.basis.guid);
        if (own === undefined) continue;
        if (row.recorder.guid !== row.basis.guid) own.refunded -= row.amount;
        else if (row.amount > 0) own.amount += row.amount;
        else own.paid -= row.amount;
    }
    return guids.map((guid): InstallmentFigures => {
        const own = figures.get(guid)!;
        return { ...own, debt: own.amount - own.paid - own.refunded };
    });
});

/** Входные данные функции `figures`: рассрочки и необязательный день. */
const figuresInput = (input: ActionInputBuilder) => input
    // Без дня суммы текущие, с днём учитываются движения по конец этого дня включительно.
    .field('date', (field) => field.date().title('На день'))
    .tablePart('installments', (part) => part
        .title('Рассрочки')
        .field('guid', (field) => field.string().title('Рассрочка').required()));

/** Функция `figures`: суммы рассрочек, текущие или на день. Документ подключает её `.function('figures', figuresFunction)`. */
export const figuresFunction = (builder: FunctionBuilder) => builder
    .title('Суммы рассрочек')
    .input(figuresInput)
    .handle((input) => installmentFigures(input.installments.map((row) => row.guid), input.date ?? null));

/** Сигнатуры функций рассрочки, выведенные из объявлений: по ним `callFunction` и `useFunctionResult` проверяют вызов. */
export type SaleInstallmentFunctions = {
    readonly figures: SignatureOf<ReturnType<typeof figuresFunction>>;
};

/**
 * Ссылка на документ рассрочки для `callFunction` из файлов, которые рассрочка сама импортирует,
 * например из продажи. Билдер `SaleInstallment` и `Objects` там недоступны: импорт замкнул бы
 * файлы и выводы их типов в круг. Сигнатуры функций ссылка несёт только в типах.
 */
export const SaleInstallmentFunctions = installmentTarget as typeof installmentTarget & { readonly '~functions': SaleInstallmentFunctions };
