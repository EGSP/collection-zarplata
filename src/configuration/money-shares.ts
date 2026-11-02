/**
 * Деление денежных сумм в копейках: доли пропорционально весам и процент от суммы. Модуль
 * не зависит от сервера и Effect, поэтому одни и те же расчёты выполняют сервер (зарплата,
 * сводка, проверка возврата) и форма возврата.
 */

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

/**
 * Часть оплаты продажи для расчёта возврата: деньги, рассрочка или неоформленная сумма рассрочки.
 * `bankPercentage` — доля банка у банковской рассрочки, у остальных частей 0.
 */
export interface PayoutPart {
    readonly amount: number;
    readonly bankPercentage: number;
}

/** Ожидаемая выдача по продаже и удержание банка, которое в неё не входит. */
export interface ExpectedPayout {
    readonly expected: number;
    readonly bankShare: number;
}

/**
 * Сколько магазин выдаёт по продаже за возвращённые товары на `total` копеек (раздел «Правила
 * учёта»). Итог товаров делится по частям оплаты продажи пропорционально их суммам, и с доли
 * банковской рассрочки вычитается доля банка: банк в расчётах после выдачи рассрочки
 * не участвует и свою долю не возвращает.
 *
 * Например, продажа на 10 000 ₽ целиком в банковскую рассрочку со ставкой 11 %: за товар
 * на 10 000 ₽ ожидается выдача 8 900 ₽, удержание банка 1 100 ₽.
 */
export const expectedPayout = (total: number, parts: ReadonlyArray<PayoutPart>): ExpectedPayout => {
    const shares = allocate(total, parts.map((part) => part.amount));
    const bankShare = parts.reduce((sum, part, index) => sum + percentOf(shares[index]!, part.bankPercentage), 0);
    return { expected: total - bankShare, bankShare };
};
