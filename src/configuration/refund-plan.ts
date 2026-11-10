/**
 * План расчётов возврата по продаже (раздел «Правила учёта», подраздел «Расчёты возврата»).
 *
 * Расчёт делится на планирование и исполнение. Планирование собирает из условий продажи список
 * операций: пополнение сертификата, погашение долга собственной рассрочки и денежную выдачу.
 * Стратегии выполняются по порядку, каждая забирает свою часть нераспределённого остатка.
 * Исполнение превращает записанные строки «Расчёты возврата» в те же операции, и обработчик вида
 * операции отдаёт по ней движения, часть продажи для зарплаты и признак снятия закрытия рассрочки.
 *
 * План не заменяет строки документа: деление денег между способами, «Откуда выдано» и погашение
 * в счёт долга выбирает продавец. План подсказывает форме, что заполнить, а политика возврата
 * сверяет с ним записанные строки.
 */
import { Effect } from 'effect';
import { movements, objectReference, type RegisterMovements } from '../server/metadata/index.js';
import { ownInstallment } from './installments.js';
import { expectedPayout, type PayoutPart } from './money-shares.js';
import { certificateRefill, debtSettlement } from './payments.js';
import type { PayrollPartKind } from './payroll-context.js';
import { CertificateBalances } from './registers/certificate-balances.register.js';
import { InstallmentDebts } from './registers/installment-debts.register.js';
import { MoneyReceipts } from './registers/money-receipts.register.js';

/** Строка оплаты продажи сертификатом и сумма, которую по ней ещё можно вернуть на сертификат. */
export interface CertificateTerms {
    readonly certificate: string;
    /** Списано с сертификата в продаже. */
    readonly amount: number;
    /** Списание за вычетом пополнений прежними проведёнными возвратами без пометки удаления. */
    readonly available: number;
}

/**
 * Условия расчёта по продаже: части её оплаты, по которым делится возврат, сертификаты
 * и рассрочка. Их читают правило расчётов возврата и форма возврата (действие `settlementTerms`).
 */
export interface SaleSettlementTerms {
    readonly sale: { readonly guid: string; readonly number: string; readonly date: string; readonly shift: string; readonly amount: number };
    /** Части оплаты продажи без сертификатов: деньги, рассрочки и неоформленная сумма рассрочки. */
    readonly parts: ReadonlyArray<PayoutPart>;
    /** Сертификаты продажи в порядке строк. */
    readonly certificates: ReadonlyArray<CertificateTerms>;
    /** Сумма оплаты «Рассрочка», которую не покрывают проведённые рассрочки без пометки удаления. */
    readonly unarranged: number;
    /** Рассрочка по продаже без пометки удаления; у продажи их не больше одной. */
    readonly installment: {
        readonly guid: string;
        readonly number: string;
        readonly date: string;
        readonly type: string | null;
        readonly posted: boolean;
        readonly closed: boolean;
        /** Остаток без погашения исключённого возврата: столько этот возврат может погасить. */
        readonly balance: number;
        /** Погашение исключённого возврата, уже записанное в рассрочку. */
        readonly settled: number;
    } | null;
}

/**
 * Операция расчёта возврата по продаже. У денежной выдачи в плане способ `null`: способ выбирает
 * продавец. `bankShare` — удержание банка, которое в выдачу не входит; у записанной строки 0.
 */
export type RefundOperation =
    | { readonly kind: 'certificateRefill'; readonly sale: string; readonly certificate: string; readonly amount: number }
    | { readonly kind: 'debtRepayment'; readonly sale: string; readonly amount: number }
    | { readonly kind: 'payout'; readonly sale: string; readonly amount: number; readonly method: string | null; readonly bankShare: number };

/** Состояние планирования: условия продажи, нераспределённый итог товаров и решённые операции. */
interface PlanningState {
    readonly terms: SaleSettlementTerms;
    readonly remaining: number;
    readonly operations: ReadonlyArray<RefundOperation>;
}

/** Стратегия забирает часть остатка и дописывает операции. Базу она не пишет. */
type PlanningStrategy = (state: PlanningState) => Effect.Effect<PlanningState>;

/**
 * Сертификат пополняется первым: по каждой строке продажи не больше того, что с него списано
 * и ещё не возвращено прежними возвратами.
 */
const certificateStrategy: PlanningStrategy = (state) => Effect.sync(() => {
    let remaining = state.remaining;
    const operations: RefundOperation[] = [];
    for (const line of state.terms.certificates) {
        const amount = Math.min(line.available, remaining);
        if (amount <= 0) continue;
        operations.push({ kind: 'certificateRefill', sale: state.terms.sale.guid, certificate: line.certificate, amount });
        remaining -= amount;
    }
    return { ...state, remaining, operations: [...state.operations, ...operations] };
});

/**
 * Затем возврат гасит долг проведённой собственной рассрочки в пределах её остатка. У закрытой
 * рассрочки предел — погашение, которое этот возврат уже записал: долг погашен, и увеличить
 * погашение нечем. Банковская рассрочка и неоформленная оплата «Рассрочка» долг не гасят.
 *
 * Доля банка при этом не теряется: у продажи одна рассрочка, и при собственной рассрочке
 * банковских частей нет.
 */
const debtStrategy: PlanningStrategy = (state) => Effect.sync(() => {
    const installment = state.terms.installment;
    if (installment === null || !installment.posted || installment.type !== ownInstallment) return state;
    const limit = installment.closed ? installment.settled : installment.balance;
    const amount = Math.min(limit, state.remaining);
    if (amount <= 0) return state;
    return { ...state, remaining: state.remaining - amount, operations: [...state.operations, { kind: 'debtRepayment', sale: state.terms.sale.guid, amount }] };
});

/** Остаток выдаётся деньгами: он делится по частям оплаты продажи, доля банка не выдаётся. */
const payoutStrategy: PlanningStrategy = (state) => Effect.sync(() => {
    if (state.remaining <= 0) return state;
    const { expected, bankShare } = expectedPayout(state.remaining, state.terms.parts);
    const payout: RefundOperation = { kind: 'payout', sale: state.terms.sale.guid, amount: expected, method: null, bankShare };
    return { ...state, remaining: 0, operations: [...state.operations, payout] };
});

/** Порядок стратегий задаёт порядок расчёта: сертификат, долг, деньги. */
const strategies: ReadonlyArray<PlanningStrategy> = [certificateStrategy, debtStrategy, payoutStrategy];

/** План расчёта по продаже за возвращённые товары на `total` копеек. */
export const planRefund = (terms: SaleSettlementTerms, total: number) => Effect.reduce(
    strategies,
    (): PlanningState => ({ terms, remaining: total, operations: [] }),
    (state, strategy) => strategy(state),
).pipe(Effect.map((state) => state.operations));

/** Сумма операций плана, которую магазин отдаёт покупателю любым способом: предел расчётов по продаже. */
export const plannedTotal = (operations: ReadonlyArray<RefundOperation>) => operations.reduce((total, operation) => total + operation.amount, 0);

/** Записанная строка расчёта возврата. */
export interface SettlementLine {
    readonly sale: string;
    readonly method: string;
    readonly amount: number;
    readonly certificate?: string | null | undefined;
}

/** Операция записанной строки: вид определяется способом строки. */
export const operationOf = (line: SettlementLine): RefundOperation => {
    if (line.method === certificateRefill) return { kind: 'certificateRefill', sale: line.sale, certificate: line.certificate ?? '', amount: line.amount };
    if (line.method === debtSettlement) return { kind: 'debtRepayment', sale: line.sale, amount: line.amount };
    return { kind: 'payout', sale: line.sale, amount: line.amount, method: line.method, bankShare: 0 };
};

/** Сведения для движений операции: смена продажи и проведённая рассрочка по ней, если она нужна. */
export interface ExecutionContext {
    readonly saleShift: string;
    readonly installment: { readonly guid: string; readonly person: string; readonly shift: string } | null;
}

/**
 * Обработчик вида операции со всеми фазами исполнения:
 *
 * - `movements` — движения проведённого возврата; знак уже учтён;
 * - `payrollPart` — часть продажи, к которой зарплата относит операцию целиком; `null` — операция
 *   делится по частям продажи пропорционально их суммам;
 * - `reopensInstallment` — уменьшение или отмена операции снова увеличивает долг рассрочки,
 *   поэтому снимает её закрытие.
 */
interface OperationHandler<Operation extends RefundOperation> {
    readonly movements: (operation: Operation, context: ExecutionContext) => ReadonlyArray<RegisterMovements>;
    readonly payrollPart: PayrollPartKind | null;
    readonly reopensInstallment: boolean;
}

/** Рассрочка по продаже: основание движений погашения. */
const installmentTarget = { kind: 'document', name: 'saleInstallment' } as const;

/**
 * Обработчики собраны по видам операций: ключи перечисляют все виды, поэтому новый вид
 * без обработчика не пройдёт проверку типов. Вычитание из нуля, а не унарный минус: для нулевой
 * суммы минус дал бы отрицательный ноль.
 */
export const refundOperationHandlers: { readonly [Kind in RefundOperation['kind']]: OperationHandler<Extract<RefundOperation, { readonly kind: Kind }>> } = {
    // Пополнение возвращает сумму на сертификат и денег не двигает. В зарплате оно относится
    // к денежной части продажи: оплату сертификатом зарплата считает денежной.
    certificateRefill: {
        movements: (operation) => [movements(CertificateBalances, [{ certificate: operation.certificate, amount: operation.amount }])],
        payrollPart: 'money',
        reopensInstallment: false,
    },
    // Погашение уменьшает долг по рассрочке продажи: основание — рассрочка, смена — смена рассрочки,
    // как у её взносов. Предел остатком проверяет ограничение регистра.
    debtRepayment: {
        movements: (operation, context) => context.installment === null ? [] : [movements(InstallmentDebts, [{
            basis: objectReference(installmentTarget, context.installment.guid), person: context.installment.person, shift: context.installment.shift, amount: 0 - operation.amount,
        }])],
        payrollPart: 'ownInstallment',
        reopensInstallment: true,
    },
    // Выданные деньги уменьшают деньги смены продажи по способу выдачи.
    payout: {
        movements: (operation, context) => operation.method === null ? [] : [movements(MoneyReceipts, [{ shift: context.saleShift, method: operation.method, amount: 0 - operation.amount }])],
        payrollPart: null,
        reopensInstallment: false,
    },
};

/** Движения операции через обработчик её вида. */
export const operationMovements = (operation: RefundOperation, context: ExecutionContext): ReadonlyArray<RegisterMovements> => {
    switch (operation.kind) {
        case 'certificateRefill': return refundOperationHandlers.certificateRefill.movements(operation, context);
        case 'debtRepayment': return refundOperationHandlers.debtRepayment.movements(operation, context);
        case 'payout': return refundOperationHandlers.payout.movements(operation, context);
    }
};
