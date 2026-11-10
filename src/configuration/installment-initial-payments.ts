/**
 * Первоначальный взнос рассрочки (раздел «Правила учёта», «Сводка за период»). Сводка показывает
 * его в строке продажи, а остальные взносы отдельной таблицей в день внесения.
 *
 * Признак не хранится, а выводится из данных рассрочки. Хранимое поле пришлось бы пересчитывать
 * при каждой записи рассрочки, в том числе после «Внести изменения», а вывод даёт тот же результат
 * без миграции и без поля, которое продавцу пришлось бы видеть или отмечать. Правило
 * «первоначальным бывает только взнос рассрочки без взносов» выполняется само: первоначальным
 * может оказаться только самый ранний взнос.
 */
import { ownInstallment } from './installments.js';

/** Рассрочка в объёме, нужном правилу: тип и дата оформления. */
export interface InitialPaymentInstallment {
    readonly type: string | null;
    readonly date: string;
}

/** Взнос в объёме, нужном правилу: дата со временем. */
export interface InitialPaymentCandidate {
    readonly date: string;
}

/** День даты: первые десять знаков, как в остальных расчётах по дням. */
const dayOf = (value: string): string => value.slice(0, 10);

/**
 * Первоначальные взносы рассрочки.
 *
 * - Банковская рассрочка: все взносы. Банк платит всю сумму сразу действием «Оплата банком».
 * - Собственная рассрочка: самый ранний взнос, если его день совпадает с днём рассрочки. При равных
 *   моментах берётся первый по порядку строк, поэтому `payments` передаются в порядке строк.
 *
 * Взнос, внесённый в день рассрочки позже неё, тоже первоначальный: деньги пришли в день продажи.
 */
export function initialPayments<Payment extends InitialPaymentCandidate>(installment: InitialPaymentInstallment, payments: ReadonlyArray<Payment>): ReadonlySet<Payment> {
    if (installment.type !== ownInstallment) return new Set(payments);
    // Даты хранятся с часовым поясом клиента, поэтому моменты сравниваются после разбора, а не как текст.
    const earliest = payments.reduce<Payment | undefined>((found, payment) => found === undefined || new Date(payment.date).getTime() < new Date(found.date).getTime() ? payment : found, undefined);
    return earliest !== undefined && dayOf(earliest.date) === dayOf(installment.date) ? new Set([earliest]) : new Set();
}
