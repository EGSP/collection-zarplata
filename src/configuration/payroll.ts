/**
 * Расчёт зарплаты продавцов за незакрытый период (раздел «Правила учёта», «Расчёт зарплаты»).
 *
 * Период начинается со дня после последнего закрытия и заканчивается заданным днём включительно.
 * Расчёт делится на две части. Чтение собирает данные периода в контекст `PayrollContext`:
 * продажи с товарами и частями оплаты, рассрочки, возвраты, смены и их составы. Затем правила
 * из `payroll-rules.ts` выполняются над этим контекстом, и их строки складываются в итоги
 * сотрудников. Правила базу не читают, поэтому меняются независимо от чтения.
 *
 * Расчёт только читает данные. Предварительный расчёт и закрытие периода вызывают одну и ту же
 * функцию, поэтому начисление при закрытии совпадает с предварительным расчётом по тот же день.
 */
import { Effect } from 'effect';
import { Database } from '../server/database/database.effect.js';
import { query } from '../server/database/sql.builder.js';
import { objectReference } from '../server/metadata/index.js';
import { InstallmentRates } from './catalogs/installment-rates.catalog.js';
import { Refund } from './documents/refund.document.js';
import { SaleInstallment } from './documents/sale-installment.document.js';
import { Sale } from './documents/sale.document.js';
import { Shift } from './documents/shift.document.js';
import { ownInstallment } from './installments.js';
import { PayrollContext, type PayrollData, type PayrollLine, type PayrollRuleDescription, type PayrollSale, type SalePart } from './payroll-context.js';
import { payrollRules } from './payroll-rules.js';
import { installmentMethod } from './payments.js';
import { dayOf, lastClosedThrough } from './policies/closed-period.js';

export type { PayrollLine, PayrollRuleDescription } from './payroll-context.js';

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
    /** Описания действующих правил по порядку. */
    readonly ruleDescriptions: ReadonlyArray<PayrollRuleDescription>;
    readonly employees: ReadonlyArray<PayrollEmployee>;
    readonly lines: ReadonlyArray<PayrollLine>;
}

/** Следующий день даты `ГГГГ-ММ-ДД`. Считается в UTC, чтобы переход на летнее время не сдвигал день. */
export const nextDay = (day: string): string => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
};

/** Отбор действующих проведённых документов: черновики и помеченные на удаление в расчёт не входят. */
const active = [
    { column: 'posted', operator: '=', value: true },
    { column: 'deletedAt', operator: '=', value: null },
] as const;

/** Уникальные значения без пустых. */
const distinct = (values: ReadonlyArray<string | null>): string[] => [...new Set(values.filter((value): value is string => value !== null))];

/**
 * Читает данные периода по день `closedThrough` включительно.
 *
 * Отбор по датам запросом грубый: строки дат хранятся с часовым поясом клиента, а период
 * задан днями. Запрос отбирает строки, чей текст попадает в интервал дней, и день события
 * сравнивается так же, как в политике закрытого периода: по первым десяти знакам даты.
 */
const loadPayrollData = (closedThrough: string) => Effect.gen(function* () {
    const database = yield* Database;
    const previous = yield* lastClosedThrough;
    const periodStart = previous === null ? null : nextDay(previous);
    const inPeriod = (date: string) => (periodStart === null || dayOf(date) >= periodStart) && dayOf(date) <= closedThrough;
    // Граница дня записана наименьшей строкой этого дня, которую принимает поле даты со временем:
    // после минут знак `+` меньше `:`, `-` и `Z`, поэтому любая дата этого дня не меньше границы.
    const dayStart = (day: string) => `${day}T00:00+00:00`;
    const dateRange = <const Column extends 'date' | 'closedAt'>(column: Column) => [
        ...periodStart === null ? [] : [{ column, operator: '>=', value: dayStart(periodStart) } as const],
        { column, operator: '<', value: dayStart(nextDay(closedThrough)) } as const,
    ];

    // События периода: смены, продажи, возвраты и рассрочки, датированные периодом.
    const shifts = (yield* database.all(query(Shift).select({ columns: ['guid', 'date'], where: dateRange('date') }))).filter((shift) => inPeriod(shift.date));
    const shiftGuids = shifts.map((shift) => shift.guid);
    const periodSales = (yield* database.all(query(Sale).select({ columns: ['guid', 'date'], where: [...active, ...dateRange('date')] }))).filter((sale) => inPeriod(sale.date));
    const refunds = (yield* database.all(query(Refund).select({ columns: ['guid', 'date'], where: [...active, ...dateRange('date')] }))).filter((refund) => inPeriod(refund.date));
    const refundLines = refunds.length === 0 ? [] : yield* database.all(query(Refund).tablePart('goods').select({
        columns: ['ownerGuid', 'name', 'discount', 'total', 'sale'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: refunds.map((refund) => refund.guid) }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));
    const installmentColumns = ['guid', 'date', 'sale', 'shift', 'type', 'rate', 'amount', 'closedAt'] as const;
    const bankInstallments = (yield* database.all(query(SaleInstallment).select({ columns: installmentColumns, where: [...active, ...dateRange('date')] })))
        .filter((installment) => installment.type !== ownInstallment && inPeriod(installment.date));
    const closedInstallments = (yield* database.all(query(SaleInstallment).select({ columns: installmentColumns, where: [...active, ...dateRange('closedAt')] })))
        .filter((installment) => installment.type === ownInstallment && installment.closedAt !== null && inPeriod(installment.closedAt));
    // Продажи и рассрочки смен периода: по ним считается выручка смены.
    const shiftSales = shiftGuids.length === 0 ? [] : yield* database.all(query(Sale).select({ columns: ['guid'], where: [...active, { column: 'shift', operator: 'IN', value: shiftGuids }] }));
    const shiftInstallments = shiftGuids.length === 0 ? [] : yield* database.all(query(SaleInstallment).select({ columns: ['sale'], where: [...active, { column: 'shift', operator: 'IN', value: shiftGuids }] }));

    // Продажи, по которым есть события периода, с товарами, оплатами и всеми рассрочками.
    const saleGuids = distinct([
        ...periodSales.map((sale) => sale.guid),
        ...shiftSales.map((sale) => sale.guid),
        ...refundLines.map((line) => line.sale),
        ...[...bankInstallments, ...closedInstallments, ...shiftInstallments].map((installment) => installment.sale),
    ]);
    const sales = new Map<string, PayrollSale>();
    const partShifts: string[] = [];
    if (saleGuids.length > 0) {
        const heads = yield* database.all(query(Sale).select({ columns: ['guid', 'date', 'shift', 'amount', 'posted'], where: [{ column: 'guid', operator: 'IN', value: saleGuids }] }));
        const goods = yield* database.all(query(Sale).tablePart('goods').select({
            columns: ['ownerGuid', 'name', 'discount', 'total'],
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
        const rateGuids = distinct(installments.map((installment) => installment.rate));
        const rates = new Map((rateGuids.length === 0 ? [] : yield* database.all(query(InstallmentRates).select({
            columns: ['guid', 'name', 'percentage'],
            where: [{ column: 'guid', operator: 'IN', value: rateGuids }],
        }))).map((rate) => [rate.guid, { name: rate.name, percentage: rate.percentage }]));
        for (const head of heads) {
            const byInstallment = payments.filter((payment) => payment.ownerGuid === head.guid && payment.method === installmentMethod)
                .reduce((total, payment) => total + payment.amount, 0);
            const saleInstallments = installments.filter((installment) => installment.sale === head.guid);
            const arranged = saleInstallments.reduce((total, installment) => total + installment.amount, 0);
            const parts: SalePart[] = [
                {
                    kind: 'money', amount: head.amount - byInstallment, shift: head.shift, rate: { name: null, percentage: 0 },
                    // Непроведённая продажа ничего не начисляет: возврат по ней тоже не проводится.
                    countedDay: head.posted ? dayOf(head.date) : null,
                    document: objectReference({ kind: 'document', name: 'sale' }, head.guid), date: head.date, installmentDate: null, installmentClosedAt: null,
                },
                ...saleInstallments.map((installment): SalePart => {
                    const own = installment.type === ownInstallment;
                    const date = own ? installment.closedAt : installment.date;
                    return {
                        kind: own ? 'ownInstallment' : 'bankInstallment', amount: installment.amount, shift: installment.shift,
                        // У рассрочек, оформленных до появления ставки, её нет: банк в расчёте не учитывается.
                        rate: (installment.rate === null ? undefined : rates.get(installment.rate)) ?? { name: null, percentage: 0 },
                        countedDay: date === null ? null : dayOf(date),
                        document: objectReference({ kind: 'document', name: 'saleInstallment' }, installment.guid), date,
                        installmentDate: installment.date, installmentClosedAt: installment.closedAt,
                    };
                }),
            ];
            partShifts.push(...parts.map((part) => part.shift));
            sales.set(head.guid, {
                guid: head.guid, shift: head.shift, amount: head.amount,
                goods: goods.filter((line) => line.ownerGuid === head.guid).map((line) => ({ name: line.name, discount: line.discount ?? 0, total: line.total })),
                parts,
                unarranged: Math.max(0, byInstallment - arranged),
            });
        }
    }

    // Составы смен всех частей продаж и смен периода.
    const memberShifts = distinct([...partShifts, ...shiftGuids]);
    const members = memberShifts.length === 0 ? [] : yield* database.all(query(Shift).tablePart('employees').select({
        columns: ['ownerGuid', 'employee'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: memberShifts }],
        orderBy: [{ column: 'ownerGuid', direction: 'ASC' }, { column: 'lineNumber', direction: 'ASC' }],
    }));

    const data: PayrollData = {
        periodStart, closedThrough, sales,
        periodSales: periodSales.map((sale) => sale.guid),
        periodInstallments: [...bankInstallments, ...closedInstallments].map((installment) => ({ sale: installment.sale, installment: installment.guid })),
        refunds: refunds.map((refund) => ({
            guid: refund.guid, date: refund.date,
            lines: refundLines.filter((line) => line.ownerGuid === refund.guid).map((line) => ({ name: line.name, discount: line.discount ?? 0, total: line.total, sale: line.sale })),
        })),
        shifts,
        employeesOf: (shift) => members.filter((member) => member.ownerGuid === shift).map((member) => member.employee),
    };
    return data;
});

/**
 * Рассчитывает зарплату с начала незакрытого периода по день `closedThrough` включительно:
 * читает данные периода и выполняет над ними правила.
 */
export const calculatePayroll = (closedThrough: string) => Effect.gen(function* () {
    const data = yield* loadPayrollData(closedThrough);
    const groups = yield* Effect.forEach(payrollRules.rules, (rule) => rule.calculate).pipe(Effect.provideService(PayrollContext, data));
    const lines = groups.flat().sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime() || first.document.guid.localeCompare(second.document.guid));
    const totals = new Map<string, number>();
    for (const line of lines) totals.set(line.employee, (totals.get(line.employee) ?? 0) + line.amount);
    const result: PayrollResult = {
        periodStart: data.periodStart, closedThrough, rules: payrollRules.title,
        ruleDescriptions: payrollRules.rules.map(({ name, title, description }) => ({ name, title, description })),
        employees: [...totals].map(([employee, amount]) => ({ employee, amount })),
        lines,
    };
    return result;
});
