/**
 * Контекст расчёта зарплаты: данные периода, общие для всех правил, и строки, которые правила
 * возвращают. Расчёт (`payroll.ts`) читает данные один раз и передаёт их правилам
 * (`payroll-rules.ts`) сервисом Effect: правило не обращается к базе и зависит только от контекста.
 *
 * Модуль отделён от расчёта и правил: правила импортируют контекст, а расчёт — список правил,
 * и общий модуль не даёт им замкнуться в кольцо.
 */
import { Context } from 'effect';
import type { ObjectReferenceValue } from '../server/metadata/descriptions.js';

/**
 * Часть продажи, которая начисляется отдельно: деньги начисляются продажей, рассрочки по продаже —
 * своими документами по своим условиям.
 */
export type PayrollPartKind = 'money' | 'bankInstallment' | 'ownInstallment';

/** Строка расшифровки: начисление одному сотруднику по одному правилу. */
export interface PayrollLine {
    readonly employee: string;
    /** Вид строки: часть продажи, возврат или бонус. */
    readonly kind: string;
    /** Документ, который начислил строку: продажа, рассрочка по продаже, возврат или смена. */
    readonly document: ObjectReferenceValue;
    /** Дата события: продажи, рассрочки, закрытия рассрочки, возврата или открытия смены. */
    readonly date: string;
    /** Продажа товара; у бонуса смены её нет. */
    readonly sale: string | null;
    /** Название товара; у бонуса смены его нет. */
    readonly goods: string | null;
    /** Сумма, с которой начислено, в копейках; у возврата отрицательная. */
    readonly base: number;
    /** Ставка в процентах; у фиксированного бонуса её нет. */
    readonly rate: number | null;
    /** Начисление в копейках; у возврата отрицательное. */
    readonly amount: number;
    /** Применённое правило словами: по нему видно, почему начислена эта сумма. */
    readonly rule: string;
    /**
     * Дата открытия рассрочки, если строка начислена частью-рассрочкой или вычтена возвратом
     * по ней; иначе `null`. По ней страница «Зарплата» показывает бонусы по рассрочкам отдельно.
     */
    readonly installmentDate: string | null;
    /** Дата закрытия рассрочки строки; `null`, если строка не по рассрочке или рассрочка не закрыта. */
    readonly installmentClosedAt: string | null;
}

/** Описание правила для пользователя: окно правил на странице «Зарплата». */
export interface PayrollRuleDescription {
    /** Имя правила в коде. */
    readonly name: string;
    readonly title: string;
    readonly description: string;
}

/** Ставка рассрочки: доля банка от суммы рассрочки. У части, оплаченной деньгами, 0 % без названия. */
export interface PartRate {
    readonly name: string | null;
    readonly percentage: number;
}

/** Часть продажи, начисляемая отдельно. */
export interface SalePart {
    readonly kind: PayrollPartKind;
    readonly amount: number;
    readonly shift: string;
    readonly rate: PartRate;
    /** День, которым часть начислена; `null`, пока она не начисляется: собственная рассрочка не закрыта. */
    readonly countedDay: string | null;
    readonly document: ObjectReferenceValue;
    /** Дата начисления части; `null` вместе с `countedDay`. */
    readonly date: string | null;
    /** Дата открытия рассрочки: у собственной она отличается от даты начисления. У части деньгами `null`. */
    readonly installmentDate: string | null;
    /** Дата закрытия рассрочки; `null`, пока она открыта, и у части деньгами. */
    readonly installmentClosedAt: string | null;
}

/** Товар продажи или возврата. */
export interface PayrollGoods {
    readonly name: string;
    /** Скидка в процентах; без скидки 0. */
    readonly discount: number;
    readonly total: number;
}

/** Продажа с товарами и частями. */
export interface PayrollSale {
    readonly guid: string;
    readonly shift: string;
    readonly amount: number;
    readonly goods: ReadonlyArray<PayrollGoods>;
    readonly parts: ReadonlyArray<SalePart>;
    /** Сумма оплат способом «Рассрочка», на которую рассрочка ещё не оформлена: она не начисляется. */
    readonly unarranged: number;
}

/** Проведённый возврат периода: строки ссылаются на продажи. */
export interface PayrollRefund {
    readonly guid: string;
    readonly date: string;
    readonly lines: ReadonlyArray<PayrollGoods & { readonly sale: string }>;
}

/** Смена, открытая в периоде. */
export interface PayrollShift {
    readonly guid: string;
    readonly date: string;
}

/** Данные периода, общие для всех правил. */
export interface PayrollData {
    /** Первый день периода; `null`, если закрытий ещё не было. */
    readonly periodStart: string | null;
    /** Последний день периода включительно. */
    readonly closedThrough: string;
    /** Продажи по `guid`: продажи периода, продажи из возвратов и рассрочек, продажи смен периода. */
    readonly sales: ReadonlyMap<string, PayrollSale>;
    /** Продажи, датированные периодом: их часть, оплаченная деньгами, начисляется в нём. */
    readonly periodSales: ReadonlyArray<string>;
    /** Рассрочки, которые начисляются в периоде: банковские по дате, собственные по дате закрытия. */
    readonly periodInstallments: ReadonlyArray<{ readonly sale: string; readonly installment: string }>;
    readonly refunds: ReadonlyArray<PayrollRefund>;
    readonly shifts: ReadonlyArray<PayrollShift>;
    /** Состав смены. */
    readonly employeesOf: (shift: string) => ReadonlyArray<string>;
}

/** Контекст расчёта: правило получает данные периода из окружения Effect. */
export const PayrollContext = Context.Service<PayrollData>('PayrollContext');

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

/**
 * Процент от суммы в копейках с округлением до копейки, половина вверх. Ставка переводится
 * в сотые доли процента, и деление остаётся целочисленным.
 */
export const percentOf = (amount: number, percentage: number): number => Math.floor((amount * Math.round(percentage * 100) + 5000) / 10000);
