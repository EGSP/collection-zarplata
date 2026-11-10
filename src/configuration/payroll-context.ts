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
    /** Процент купона строки; без купона 0. Ступень ставки считается по скидке вместе с купоном. */
    readonly coupon: number;
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
    /**
     * Сумма оплаты сертификатами. Она входит в денежную часть, но возврат по ней пополняет
     * сертификат, поэтому остальной возврат делится по денежной части без неё.
     */
    readonly certificates: number;
    /**
     * Все проведённые возвраты по продаже, в любом периоде. Собственная рассрочка начисляется при
     * закрытии за вычетом возвращённого до закрытия, даже если возврат был в прошлом периоде.
     */
    readonly refunds: ReadonlyArray<PayrollRefund>;
}

/** Проведённый возврат периода: строки ссылаются на продажи. */
export interface PayrollRefund {
    readonly guid: string;
    readonly date: string;
    readonly lines: ReadonlyArray<PayrollGoods & { readonly sale: string }>;
    /**
     * Суммы строк расчёта, которые относятся к одной части продажи целиком, по продажам и видам
     * частей: погашение «В счёт долга» к собственной рассрочке, пополнение «На сертификат»
     * к денежной части. Часть задаёт обработчик вида операции (`refund-plan.ts`).
     */
    readonly directed: ReadonlyMap<string, ReadonlyMap<PayrollPartKind, number>>;
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

/** Деление сумм общее с проверкой возврата и его формой: функции лежат в модуле без зависимостей. */
export { allocate, percentOf } from './money-shares.js';
