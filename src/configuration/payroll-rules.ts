/**
 * Правила начисления зарплаты (раздел «Правила учёта», «Расчёт зарплаты»).
 *
 * Каждое правило — отдельный эффект над контекстом расчёта `PayrollContext`: он читает данные
 * периода и возвращает свои строки начисления с текстом применённого правила. Расчёт выполняет
 * правила из списка `payrollRules.rules` над одним контекстом и складывает их строки. Новое
 * правило добавляется функцией и строкой списка, остальные правила при этом не меняются.
 *
 * При изменении правил меняется и `title`: название сохраняется в закрытии периода и показывает,
 * по каким правилам посчитан закрытый период. Закрытые начисления правила не пересчитывают.
 */
import { Effect } from 'effect';
import { objectReference } from '../server/metadata/index.js';
import { formatMoney } from '../server/ui/value-format.js';
import { allocate, percentOf, PayrollContext, type PayrollData, type PayrollLine, type PayrollPartKind, type PayrollRefund, type PayrollRuleDescription, type PayrollSale, type SalePart } from './payroll-context.js';

/** Правило: читает контекст расчёта и возвращает свои строки. */
// Требование эффекта — данные периода: сервис `PayrollContext` объявлен по их интерфейсу.
export type PayrollRule = Effect.Effect<ReadonlyArray<PayrollLine>, never, PayrollData>;

/** Вид строки расшифровки. */
const kinds = {
    money: 'Продажа',
    bankInstallment: 'Банковская рассрочка',
    ownInstallment: 'Собственная рассрочка',
    refund: 'Возврат',
    shiftBonus: 'Бонус за выручку смены',
} as const;

/** Процент словами: «2,5 %». */
const percent = (value: number): string => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`;

/** Сумма словами: «80 000,00 ₽». */
const rubles = (kopecks: number): string => `${formatMoney(kopecks)} ₽`;

/** Скидка товара (вместе со ставкой рассрочки), с которой действует ставка 2,5 %; ниже неё — 4 %. */
const discountLimit = 30;

/**
 * Ступень ставки по товару: скидка меньше 30 % — 4 %, 30 % и больше — 2,5 %. Купон уменьшает цену
 * так же, как скидка, поэтому его процент прибавляется к скидке строки. Для части в рассрочку
 * прибавляется и ставка рассрочки: доля банка уменьшает доход магазина так же, как скидка.
 * Сравнение идёт в сотых долях процента, чтобы сумма дробных процентов не давала погрешности
 * на границе.
 */
export const goodsRate = (goods: { readonly discount: number; readonly coupon: number }, part: SalePart): { readonly rate: number; readonly rule: string } => {
    const terms = [
        { title: 'Скидка', value: goods.discount, shown: true },
        { title: 'купон', value: goods.coupon, shown: goods.coupon > 0 },
        { title: `ставка «${part.rate.name ?? ''}»`, value: part.rate.percentage, shown: part.rate.percentage > 0 },
    ].filter((term) => term.shown);
    const total = terms.reduce((sum, term) => sum + Math.round(term.value * 100), 0);
    const rate = total < discountLimit * 100 ? 4 : 2.5;
    // Одно слагаемое выводится без суммы: «Скидка 10 %», а не «Скидка 10 % = 10 %».
    const reduction = terms.map((term) => `${term.title} ${percent(term.value)}`).join(' + ') + (terms.length > 1 ? ` = ${percent(total / 100)}` : '');
    const base = part.rate.percentage > 0 ? `итога товара за вычетом ставки ${percent(part.rate.percentage)}` : 'итога товара';
    return { rate, rule: `${reduction} ${rate === 4 ? '<' : '≥'} ${percent(discountLimit)} → ${percent(rate)} от ${base}` };
};

/**
 * Строки начисления доли `share` товара части `part` каждому сотруднику её смены. База — доля
 * за вычетом доли банка по ставке рассрочки. `sign` отрицателен у возврата: он вычитает то,
 * что часть начислила за этот товар.
 */
const goodsLines = (
    context: PayrollData,
    part: SalePart,
    sale: string,
    goods: { readonly name: string; readonly discount: number; readonly coupon: number },
    share: number,
    sign: 1 | -1,
    event: { readonly kind: string; readonly document: PayrollLine['document']; readonly date: string },
): PayrollLine[] => {
    if (share === 0) return [];
    const base = share - percentOf(share, part.rate.percentage);
    const { rate, rule } = goodsRate(goods, part);
    const amount = percentOf(base, rate);
    // Вычитание из нуля, а не унарный минус: для нулевой суммы он дал бы отрицательный ноль.
    const signed = (value: number) => sign === 1 ? value : 0 - value;
    return context.employeesOf(part.shift).map((employee) => ({
        employee, kind: event.kind, document: event.document, date: event.date, sale, goods: goods.name,
        base: signed(base), rate, amount: signed(amount), rule: sign === 1 ? rule : `Возврат: ${rule.charAt(0).toLowerCase()}${rule.slice(1)}`,
        installmentDate: part.installmentDate, installmentClosedAt: part.installmentClosedAt,
    }));
};

/** Момент даты: строки хранятся с часовым поясом клиента, и их сравнение дало бы неверный порядок. */
const moment = (date: string): number => new Date(date).getTime();

/**
 * Возврат оформлен до закрытия собственной рассрочки: тогда его доля в рассрочке уменьшает её
 * начисление, а не вычитается отдельно. У незакрытой рассрочки до закрытия оформлен любой возврат.
 */
const beforeClosing = (refund: PayrollRefund, part: SalePart) => part.installmentClosedAt === null || moment(refund.date) <= moment(part.installmentClosedAt);

/**
 * Начисляет часть продажи по её товарам пропорционально их итогам. Собственная рассрочка
 * начисляется за вычетом своей доли во всех возвратах по продаже, оформленных до её закрытия,
 * в каком бы периоде они ни были: в счёт долга и деньгами. Возвращённый товар бонус не даёт,
 * а вычесть его долю в периоде возврата было нельзя: рассрочка тогда ещё не начислялась.
 */
const partLines = (context: PayrollData, sale: PayrollSale, part: SalePart): PayrollLine[] => {
    const index = sale.parts.indexOf(part);
    const returned = part.kind !== 'ownInstallment' ? 0 : sale.refunds.filter((refund) => beforeClosing(refund, part))
        .reduce((total, refund) => total + refundShares(refund, sale).reduce((sum, { shares }) => sum + shares[index]!, 0), 0);
    const shares = allocate(Math.max(0, part.amount - returned), sale.goods.map((line) => line.total));
    return sale.goods.flatMap((line, index) => goodsLines(context, part, sale.guid, line, shares[index]!, 1, { kind: kinds[part.kind], document: part.document, date: part.date! }));
};

/** Продажа периода начисляет часть, оплаченную деньгами, составу смены продажи. */
const moneyGoods: PayrollRule = Effect.gen(function* () {
    const context = yield* PayrollContext;
    return context.periodSales.flatMap((guid) => {
        const sale = context.sales.get(guid);
        const money = sale?.parts.find((part) => part.kind === 'money');
        return sale === undefined || money === undefined ? [] : partLines(context, sale, money);
    });
});

/**
 * Рассрочка начисляет свою сумму составу своей смены: банковская датой рассрочки, собственная
 * датой закрытия. Незакрытая собственная рассрочка не начисляется даже при почти полном погашении.
 */
const installmentGoods: PayrollRule = Effect.gen(function* () {
    const context = yield* PayrollContext;
    return context.periodInstallments.flatMap(({ sale: guid, installment }) => {
        const sale = context.sales.get(guid);
        const part = sale?.parts.find((candidate) => candidate.document.guid === installment);
        return sale === undefined || part === undefined ? [] : partLines(context, sale, part);
    });
});

/** Доли строки возврата по частям продажи и погашение долга, вошедшее в долю собственной рассрочки. */
interface RefundLineShares {
    readonly line: PayrollRefund['lines'][number];
    /** Доли по частям продажи в порядке `sale.parts`; неоформленная сумма рассрочки в них не входит. */
    readonly shares: ReadonlyArray<number>;
}

/**
 * Делит строки возврата `refund` по продаже `sale` по частям её оплаты (раздел «Правила учёта»).
 *
 * Суммы, которые обработчик операции относит к одной части (`directed`), достаются ей целиком
 * и делятся по строкам пропорционально их итогам: погашение долга относится к собственной
 * рассрочке, пополнение сертификата к денежной части. Части забирают их по порядку частей
 * продажи, не больше итога товаров.
 *
 * Остаток строки делится по остальным частям продажи, включая неоформленную сумму рассрочки,
 * пропорционально их суммам. Собственная рассрочка с погашением в остатке не участвует, денежная
 * часть участвует без оплаты сертификатами: возврат по сертификату уже вернулся на него. Если
 * других частей нет, остаток относится к первой части с направленной суммой, а без неё
 * к собственной рассрочке, как прежде.
 */
const refundShares = (refund: PayrollRefund, sale: PayrollSale): RefundLineShares[] => {
    const lines = refund.lines.filter((line) => line.sale === sale.guid);
    const totals = lines.map((line) => line.total);
    const own = sale.parts.findIndex((part) => part.kind === 'ownInstallment');
    const requested = refund.directed.get(sale.guid) ?? new Map<PayrollPartKind, number>();
    let left = totals.reduce((total, amount) => total + amount, 0);
    const directed = sale.parts.map((part) => {
        // Сумма вида достаётся первой части этого вида: у продажи одна денежная часть и одна рассрочка.
        if (sale.parts.findIndex((candidate) => candidate.kind === part.kind) !== sale.parts.indexOf(part)) return 0;
        const amount = Math.min(requested.get(part.kind) ?? 0, left);
        left -= amount;
        return amount;
    });
    const perLine = directed.map((amount) => allocate(amount, totals));
    const others = [...sale.parts.map((part, index) => {
        if (part.kind === 'ownInstallment' && directed[index]! > 0) return 0;
        return part.kind === 'money' ? Math.max(0, part.amount - sale.certificates) : part.amount;
    }), sale.unarranged];
    const fallback = directed.findIndex((amount) => amount > 0);
    const target = fallback === -1 ? own : fallback;
    const weights = others.some((weight) => weight > 0) ? others : [...sale.parts.map((_part, index) => index === target ? 1 : 0), 0];
    return lines.map((line, position) => {
        const lineDirected = perLine.reduce((total, shares) => total + shares[position]!, 0);
        const shares = allocate(line.total - lineDirected, weights).slice(0, sale.parts.length);
        return { line, shares: shares.map((share, index) => share + perLine[index]![position]!) };
    });
};

/**
 * Возврат делит итог товара по частям продажи (`refundShares`) и вычитает только части,
 * начисленные не позже конца периода: остальные ещё не начислялись. Долю собственной рассрочки
 * возврат вычитает, только если оформлен после её закрытия: возврат до закрытия уже уменьшил
 * начисление рассрочки (`partLines`). Ставка берётся по действующим правилам.
 */
const refunds: PayrollRule = Effect.gen(function* () {
    const context = yield* PayrollContext;
    return context.refunds.flatMap((refund) => {
        const document = objectReference({ kind: 'document', name: 'refund' }, refund.guid);
        return [...new Set(refund.lines.map((line) => line.sale))].flatMap((guid) => {
            const sale = context.sales.get(guid);
            if (sale === undefined) return [];
            return refundShares(refund, sale).flatMap(({ line, shares }) => sale.parts.flatMap((part, index) => {
                if (part.countedDay === null || part.countedDay > context.closedThrough) return [];
                if (part.kind === 'ownInstallment' && beforeClosing(refund, part)) return [];
                return goodsLines(context, part, sale.guid, line, shares[index]!, -1, { kind: kinds.refund, document, date: refund.date });
            }));
        });
    });
});

/** Выручка смены, с которой каждому сотруднику её состава начисляется бонус. */
const bonusTurnover = 8_000_000;

/** Бонус каждому сотруднику смены при выручке не меньше порога. */
const bonusAmount = 100_000;

/**
 * Бонус за выручку смены. Выручка — части продаж смены, оплаченные деньгами, и полные суммы
 * рассрочек, закреплённых за сменой, без учёта взносов, закрытия и доли банка: для этого правила
 * рассрочка считается датой оформления. Возвраты, проведённые в том же периоде, уменьшают
 * выручку на свою долю частей смены; возврат в следующем периоде начисленный бонус не отменяет.
 */
const shiftBonus: PayrollRule = Effect.gen(function* () {
    const context = yield* PayrollContext;
    const turnover = new Map(context.shifts.map((shift) => [shift.guid, 0]));
    const add = (shift: string, amount: number) => {
        const current = turnover.get(shift);
        if (current !== undefined) turnover.set(shift, current + amount);
    };
    for (const sale of context.sales.values()) {
        for (const part of sale.parts) {
            // Часть деньгами есть только у проведённой продажи; рассрочки в контексте только проведённые.
            if (part.kind === 'money' && part.countedDay === null) continue;
            add(part.shift, part.amount);
        }
    }
    for (const refund of context.refunds) {
        for (const guid of new Set(refund.lines.map((line) => line.sale))) {
            const sale = context.sales.get(guid);
            if (sale === undefined) continue;
            // Выручка считает рассрочку полной суммой, поэтому вычитается вся доля возврата, вместе с погашением.
            for (const { shares } of refundShares(refund, sale)) {
                sale.parts.forEach((part, index) => {
                    if (part.kind !== 'money' || part.countedDay !== null) add(part.shift, 0 - shares[index]!);
                });
            }
        }
    }
    return context.shifts.flatMap((shift) => {
        const amount = turnover.get(shift.guid) ?? 0;
        if (amount < bonusTurnover) return [];
        const rule = `Выручка смены ${rubles(amount)} ≥ ${rubles(bonusTurnover)} → ${rubles(bonusAmount)} каждому`;
        return context.employeesOf(shift.guid).map((employee): PayrollLine => ({
            employee, kind: kinds.shiftBonus, document: objectReference({ kind: 'document', name: 'shift' }, shift.guid), date: shift.date,
            sale: null, goods: null, base: amount, rate: null, amount: bonusAmount, rule, installmentDate: null, installmentClosedAt: null,
        }));
    });
});

/**
 * Правило с описанием: расчёт выполняет `calculate`, а название и описание показывает окно
 * правил на странице «Зарплата». Описание хранится рядом с расчётом, поэтому меняется вместе с ним.
 */
export interface PayrollRuleDefinition extends PayrollRuleDescription {
    readonly calculate: PayrollRule;
}

/** Ступени ставки по товару словами: общая часть описаний правил товаров. */
const tiers = `Если скидка на товар меньше ${percent(discountLimit)}, бонус равен ${percent(4)} от цены со скидкой, если ${percent(discountLimit)} и больше — ${percent(2.5)}. `
    + 'Процент купона прибавляется к скидке: скидка 25 % и купон 10 % вместе дают 35 %.';

/** Действующие правила. */
export const payrollRules = {
    /** Название версии правил: сохраняется в закрытии периода. */
    title: 'Ступени 4 % и 2,5 % с границей 30 %, бонус смены от 80 000 ₽',
    /** Правила по порядку строк в расшифровке. */
    rules: [
        {
            name: 'moneyGoods', title: 'Продажа за деньги', calculate: moneyGoods,
            description: `С каждого проданного товара сотрудники смены получают бонус. ${tiers} `
                + 'Оплата сертификатом считается денежной, даже если сертификат выдан без оплаты. '
                + 'Бонус получает каждый сотрудник смены, между ними сумма не делится.',
        },
        {
            name: 'installmentGoods', title: 'Рассрочка', calculate: installmentGoods,
            description: 'Товар в рассрочку тоже приносит бонус, его получают сотрудники смены, которая оформила рассрочку. '
                + 'Банковская рассрочка засчитывается сразу при оформлении, собственная — когда покупатель её погасил и рассрочку закрыли. '
                + 'Товары, возвращённые до закрытия собственной рассрочки, в неё не засчитываются — и в счёт долга, и деньгами. '
                + 'Банк забирает свою долю, поэтому бонус считается от цены за вычетом ставки банка, а ставка банка прибавляется к скидке. '
                + `Например, скидка 10 % и ставка банка 12 % вместе дают 22 %: это меньше ${percent(discountLimit)}, и бонус равен ${percent(4)}.`,
        },
        {
            name: 'refunds', title: 'Возврат', calculate: refunds,
            description: 'Если покупатель вернул товар, бонус за него вычитается у тех сотрудников, которые его получили. Вычет попадает в период, когда оформлен возврат. '
                + 'Часть возврата в счёт долга по собственной рассрочке относится к этой рассрочке, пополнение сертификата относится к денежной части, остальное — к остальным частям оплаты продажи. '
                + 'Если товар вернули до закрытия собственной рассрочки, отдельно вычитать не нужно: рассрочка засчитывается при закрытии уже без него, даже если возврат был в прошлом периоде.',
        },
        {
            name: 'shiftBonus', title: 'Бонус за выручку смены', calculate: shiftBonus,
            description: `Если смена продала на ${rubles(bonusTurnover)} и больше, каждый сотрудник смены получает дополнительно ${rubles(bonusAmount)}. `
                + 'Рассрочки, оформленные в смене, входят в выручку полной суммой, даже если покупатель ещё ничего не внёс. '
                + 'Возвраты того же периода уменьшают выручку, и бонус может пропасть.',
        },
    ] as ReadonlyArray<PayrollRuleDefinition>,
};
