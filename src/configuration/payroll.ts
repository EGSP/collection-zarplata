/**
 * Расчёт зарплаты продавцов за незакрытый период (раздел «Правила учёта», «Зарплата»).
 *
 * Период начинается со дня после последнего закрытия и заканчивается заданным днём включительно.
 * Событие относится к периоду своей датой, а к сотрудникам — составом смены:
 *
 * - продажа начисляет часть, оплаченную деньгами, составу смены продажи датой продажи;
 * - банковская рассрочка по продаже начисляет свою сумму составу своей смены датой рассрочки;
 * - собственная рассрочка начисляет свою сумму составу своей смены датой закрытия;
 * - возврат вычитает начисленные части возвращённого товара датой возврата.
 *
 * Расчёт читает строки товаров и оплаты документов, а не итоги регистров: правила зависят
 * от товаров, а регистры хранят суммы по продажам. Ставку задают правила `payroll-rules.ts`.
 *
 * Расчёт только читает данные. Предварительный расчёт и закрытие периода вызывают одну и ту же
 * функцию, поэтому начисление при закрытии совпадает с предварительным расчётом по тот же день.
 */
import { Effect } from 'effect';
import { Database } from '../server/database/database.effect.js';
import { query } from '../server/database/sql.builder.js';
import type { ObjectReferenceValue } from '../server/metadata/descriptions.js';
import { objectReference } from '../server/metadata/index.js';
import { Refund } from './documents/refund.document.js';
import { SaleInstallment } from './documents/sale-installment.document.js';
import { Sale } from './documents/sale.document.js';
import { Shift } from './documents/shift.document.js';
import { ownInstallment } from './installments.js';
import { installmentMethod } from './payments.js';
import { dayOf, lastClosedThrough } from './policies/closed-period.js';
import { payrollRules, type PayrollPartKind } from './payroll-rules.js';

/** Вид строки начисления в расшифровке: часть продажи или возврат. */
export const payrollKinds = {
    money: 'Продажа',
    bankInstallment: 'Банковская рассрочка',
    ownInstallment: 'Собственная рассрочка',
    refund: 'Возврат',
} as const satisfies Record<PayrollPartKind | 'refund', string>;

/** Строка расшифровки: начисление одному сотруднику за один товар одной части или возврата. */
export interface PayrollLine {
    readonly employee: string;
    /** Вид строки из `payrollKinds`. */
    readonly kind: string;
    /** Документ, который начислил строку: продажа, рассрочка по продаже или возврат. */
    readonly document: ObjectReferenceValue;
    /** Дата события: продажи, рассрочки, закрытия рассрочки или возврата. */
    readonly date: string;
    readonly sale: string;
    /** Название товара. */
    readonly goods: string;
    /** Доля итога товара, с которой начислено, в копейках; у возврата отрицательная. */
    readonly base: number;
    /** Ставка в процентах. */
    readonly rate: number;
    /** Начисление в копейках; у возврата отрицательное. */
    readonly amount: number;
}

/** Итог сотрудника за период. */
export interface PayrollEmployee {
    readonly employee: string;
    readonly amount: number;
}

/** Результат расчёта за период. */
export interface PayrollResult {
    /** Первый день периода; `null`, если закрытий ещё не было и период начинается с начала учёта. */
    readonly periodStart: string | null;
    /** Последний день периода включительно. */
    readonly closedThrough: string;
    /** Название версии правил. */
    readonly rules: string;
    readonly employees: ReadonlyArray<PayrollEmployee>;
    readonly lines: ReadonlyArray<PayrollLine>;
}

/** Следующий день даты `ГГГГ-ММ-ДД`. Считается в UTC, чтобы переход на летнее время не сдвигал день. */
export const nextDay = (day: string): string => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
};

/**
 * Делит `total` копеек пропорционально весам так, чтобы доли в сумме дали ровно `total`.
 * Каждая доля сначала округляется вниз, оставшиеся копейки получают доли с наибольшим
 * отброшенным остатком, при равных остатках — первые. Без весов все доли нулевые.
 */
export const allocate = (total: number, weights: ReadonlyArray<number>): number[] => {
    const sum = weights.reduce((accumulated, weight) => accumulated + weight, 0);
    if (sum === 0) return weights.map(() => 0);
    // Целочисленное деление с остатком: произведения в копейках меньше 2^53, точность не теряется.
    const shares = weights.map((weight, index) => ({ index, share: Math.floor((total * weight) / sum), remainder: (total * weight) % sum }));
    let left = total - shares.reduce((accumulated, share) => accumulated + share.share, 0);
    for (const share of [...shares].sort((first, second) => second.remainder - first.remainder || first.index - second.index)) {
        if (left === 0) break;
        share.share += 1;
        left -= 1;
    }
    return shares.map((share) => share.share);
};

/** Процент от суммы в копейках с округлением до копейки, половина вверх. Ставка переводится в сотые доли процента, и деление остаётся целочисленным. */
const percentOf = (base: number, rate: number): number => Math.floor((base * Math.round(rate * 100) + 5000) / 10000);

/** Часть продажи, начисляемая отдельно. */
interface SalePart {
    readonly kind: PayrollPartKind;
    readonly amount: number;
    readonly shift: string;
    /** День, которым часть начислена; `null`, пока она не начисляется: собственная рассрочка не закрыта. */
    readonly countedDay: string | null;
    readonly document: ObjectReferenceValue;
    readonly date: string | null;
}

/** Продажа с товарами и частями. */
interface SaleData {
    readonly guid: string;
    readonly amount: number;
    readonly goods: ReadonlyArray<{ readonly name: string; readonly total: number }>;
    readonly parts: ReadonlyArray<SalePart>;
    /** Сумма оплат способом «Рассрочка», на которую рассрочка ещё не оформлена: она не начисляется. */
    readonly unarranged: number;
}

/** Отбор действующих проведённых документов: черновики и помеченные на удаление в расчёт не входят. */
const active = [
    { column: 'posted', operator: '=', value: true },
    { column: 'deletedAt', operator: '=', value: null },
] as const;

/**
 * Рассчитывает зарплату с начала незакрытого периода по день `closedThrough` включительно.
 *
 * Отбор по датам запросом грубый: строки дат хранятся с часовым поясом клиента, а период
 * задан днями. Запрос отбирает строки, чей текст попадает в интервал дней, и день события
 * сравнивается так же, как в политике закрытого периода: по первым десяти знакам даты.
 */
export const calculatePayroll = (closedThrough: string) => Effect.gen(function* () {
    const database = yield* Database;
    const previous = yield* lastClosedThrough;
    const periodStart = previous === null ? null : nextDay(previous);
    const periodEnd = nextDay(closedThrough);
    const inPeriod = (date: string) => (periodStart === null || dayOf(date) >= periodStart) && dayOf(date) <= closedThrough;
    // Граница дня записана наименьшей строкой этого дня, которую принимает поле даты со временем:
    // после минут знак `+` меньше `:`, `-` и `Z`, поэтому любая дата этого дня не меньше границы.
    const dayStart = (day: string) => `${day}T00:00+00:00`;
    const dateRange = <const Column extends 'date' | 'closedAt'>(column: Column) => [
        ...periodStart === null ? [] : [{ column, operator: '>=', value: dayStart(periodStart) } as const],
        { column, operator: '<', value: dayStart(periodEnd) } as const,
    ];

    // События периода: продажи, возвраты и рассрочки, которые начисляются в этом периоде.
    const periodSales = (yield* database.all(query(Sale).select({ columns: ['guid', 'date'], where: [...active, ...dateRange('date')] })))
        .filter((sale) => inPeriod(sale.date));
    const refunds = (yield* database.all(query(Refund).select({ columns: ['guid', 'date'], where: [...active, ...dateRange('date')] })))
        .filter((refund) => inPeriod(refund.date));
    const refundLines = refunds.length === 0 ? [] : yield* database.all(query(Refund).tablePart('goods').select({
        columns: ['ownerGuid', 'name', 'total', 'sale'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: refunds.map((refund) => refund.guid) }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const installmentColumns = ['guid', 'date', 'sale', 'shift', 'type', 'amount', 'closedAt'] as const;
    const bankInstallments = (yield* database.all(query(SaleInstallment).select({ columns: installmentColumns, where: [...active, ...dateRange('date')] })))
        .filter((installment) => installment.type !== ownInstallment && inPeriod(installment.date));
    const closedInstallments = (yield* database.all(query(SaleInstallment).select({ columns: installmentColumns, where: [...active, ...dateRange('closedAt')] })))
        .filter((installment) => installment.type === ownInstallment && installment.closedAt !== null && inPeriod(installment.closedAt));

    // Продажи, по которым есть события периода, с товарами, оплатами и всеми рассрочками.
    const saleGuids = [...new Set([
        ...periodSales.map((sale) => sale.guid),
        ...refundLines.map((line) => line.sale),
        ...bankInstallments.map((installment) => installment.sale),
        ...closedInstallments.map((installment) => installment.sale),
    ])];
    const sales = new Map<string, SaleData>();
    if (saleGuids.length > 0) {
        const heads = yield* database.all(query(Sale).select({ columns: ['guid', 'date', 'shift', 'amount', 'posted'], where: [{ column: 'guid', operator: 'IN', value: saleGuids }] }));
        const goods = yield* database.all(query(Sale).tablePart('goods').select({
            columns: ['ownerGuid', 'name', 'total'],
            where: [{ column: 'ownerGuid', operator: 'IN', value: saleGuids }],
            orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
        }));
        const payments = yield* database.all(query(Sale).tablePart('payments').select({
            columns: ['ownerGuid', 'method', 'amount'],
            where: [{ column: 'ownerGuid', operator: 'IN', value: saleGuids }],
        }));
        const installments = yield* database.all(query(SaleInstallment).select({
            columns: installmentColumns,
            where: [...active, { column: 'sale', operator: 'IN', value: saleGuids }],
        }));
        for (const head of heads) {
            const byInstallment = payments.filter((payment) => payment.ownerGuid === head.guid && payment.method === installmentMethod)
                .reduce((total, payment) => total + payment.amount, 0);
            const saleInstallments = installments.filter((installment) => installment.sale === head.guid);
            const arranged = saleInstallments.reduce((total, installment) => total + installment.amount, 0);
            const parts: SalePart[] = [
                {
                    kind: 'money', amount: head.amount - byInstallment, shift: head.shift,
                    // Непроведённая продажа ничего не начисляет: возврат по ней тоже не проводится.
                    countedDay: head.posted ? dayOf(head.date) : null,
                    document: objectReference({ kind: 'document', name: 'sale' }, head.guid), date: head.date,
                },
                ...saleInstallments.map((installment): SalePart => {
                    const own = installment.type === ownInstallment;
                    const date = own ? installment.closedAt : installment.date;
                    return {
                        kind: own ? 'ownInstallment' : 'bankInstallment', amount: installment.amount, shift: installment.shift,
                        countedDay: date === null ? null : dayOf(date),
                        document: objectReference({ kind: 'document', name: 'saleInstallment' }, installment.guid), date,
                    };
                }),
            ];
            sales.set(head.guid, {
                guid: head.guid, amount: head.amount,
                goods: goods.filter((line) => line.ownerGuid === head.guid).map((line) => ({ name: line.name, total: line.total })),
                parts,
                unarranged: Math.max(0, byInstallment - arranged),
            });
        }
    }

    // Составы смен всех начисляемых частей.
    const shiftGuids = [...new Set([...sales.values()].flatMap((sale) => sale.parts.map((part) => part.shift)))];
    const members = shiftGuids.length === 0 ? [] : yield* database.all(query(Shift).tablePart('employees').select({
        columns: ['ownerGuid', 'employee'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: shiftGuids }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const employeesOf = (shift: string) => members.filter((member) => member.ownerGuid === shift).map((member) => member.employee);

    const lines: PayrollLine[] = [];
    /** Начисляет каждому сотруднику смены часть `base` товара; `sign` отрицателен у возврата. */
    const accrue = (part: SalePart, sale: string, goods: string, base: number, sign: 1 | -1, kind: string, document: ObjectReferenceValue, date: string) => {
        if (base === 0) return;
        const rate = payrollRules.rate({ part: part.kind, goods, base });
        const amount = percentOf(base, rate);
        for (const employee of employeesOf(part.shift)) {
            // Вычитание из нуля, а не унарный минус: для нулевой суммы он дал бы отрицательный ноль.
            lines.push({ employee, kind, document, date, sale, goods, base: sign === 1 ? base : 0 - base, rate, amount: sign === 1 ? amount : 0 - amount });
        }
    };
    /** Начисляет часть продажи по её товарам пропорционально их итогам. */
    const accruePart = (sale: SaleData, part: SalePart) => {
        const shares = allocate(part.amount, sale.goods.map((line) => line.total));
        sale.goods.forEach((line, index) => accrue(part, sale.guid, line.name, shares[index]!, 1, payrollKinds[part.kind], part.document, part.date!));
    };

    for (const { guid } of periodSales) {
        const sale = sales.get(guid);
        const money = sale?.parts.find((part) => part.kind === 'money');
        if (sale !== undefined && money !== undefined) accruePart(sale, money);
    }
    for (const installment of [...bankInstallments, ...closedInstallments]) {
        const sale = sales.get(installment.sale);
        const part = sale?.parts.find((candidate) => candidate.document.guid === installment.guid);
        if (sale !== undefined && part !== undefined) accruePart(sale, part);
    }
    // Возврат делит итог товара по всем частям продажи, включая неоформленную сумму рассрочки,
    // и вычитает только части, начисленные не позже конца периода: остальные ещё не начислялись.
    for (const refund of refunds) {
        const document = objectReference({ kind: 'document', name: 'refund' }, refund.guid);
        for (const line of refundLines.filter((candidate) => candidate.ownerGuid === refund.guid)) {
            const sale = sales.get(line.sale);
            if (sale === undefined) continue;
            const shares = allocate(line.total, [...sale.parts.map((part) => part.amount), sale.unarranged]);
            sale.parts.forEach((part, index) => {
                if (part.countedDay !== null && part.countedDay <= closedThrough) accrue(part, sale.guid, line.name, shares[index]!, -1, payrollKinds.refund, document, refund.date);
            });
        }
    }

    lines.sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime() || first.document.guid.localeCompare(second.document.guid));
    const totals = new Map<string, number>();
    for (const line of lines) totals.set(line.employee, (totals.get(line.employee) ?? 0) + line.amount);
    const result: PayrollResult = {
        periodStart, closedThrough, rules: payrollRules.title,
        employees: [...totals].map(([employee, amount]) => ({ employee, amount })),
        lines,
    };
    return result;
});
