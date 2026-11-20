import { allocate } from './money-shares.js';

/** Денежные колонки сводки, из которых складывается «Итого». */
type SummaryColumn = 'cash' | 'cashless' | 'installment';

/** Позиция расшифровки в копейках. Вид отличает денежные позиции от долга и пустого приёмника. */
export interface BreakdownEntry {
    readonly kind: 'receiver' | 'missing' | 'balance' | 'debt';
    readonly name: string;
    readonly amount: number;
}

/** Исходные позиции по трём способам оплаты. */
export type BreakdownColumns = Readonly<Record<SummaryColumn, ReadonlyArray<BreakdownEntry>>>;

/** Расшифровка отчёта, включая сумму позиций всех трёх способов. */
export type SummaryBreakdown = BreakdownColumns & { readonly total: ReadonlyArray<BreakdownEntry> };

/** Создаёт пустые списки для накопления позиций в каждой колонке. */
export function emptyBreakdown(): Record<SummaryColumn, BreakdownEntry[]> {
    return { cash: [], cashless: [], installment: [] };
}

/** Собирает оплаты и выдачи с одним названием. Неденежные позиции сохраняют свой вид. */
function mergeBreakdownEntries(entries: ReadonlyArray<BreakdownEntry>): BreakdownEntry[] {
    const merged = new Map<string, BreakdownEntry>();
    for (const entry of entries) {
        const key = JSON.stringify([entry.kind, entry.name]);
        const previous = merged.get(key);
        merged.set(key, { ...entry, amount: (previous?.amount ?? 0) + entry.amount });
    }
    return [...merged.values()].filter((entry) => entry.amount !== 0);
}

/** Складывает расшифровки продаж, возвратов или зон по колонкам. */
export function mergeBreakdowns(breakdowns: ReadonlyArray<BreakdownColumns>): SummaryBreakdown {
    const cash = mergeBreakdownEntries(breakdowns.flatMap((breakdown) => breakdown.cash));
    const cashless = mergeBreakdownEntries(breakdowns.flatMap((breakdown) => breakdown.cashless));
    const installment = mergeBreakdownEntries(breakdowns.flatMap((breakdown) => breakdown.installment));
    return { cash, cashless, installment, total: mergeBreakdownEntries([...cash, ...cashless, ...installment]) };
}

/**
 * Раскладывает позиции поверх уже рассчитанных долей товаров. Каждая следующая позиция использует
 * остатки долей. Поэтому копейки сохраняются и по каждому приёмнику, и по каждой зоне.
 * Для возврата доли и расчёты передаются положительными, знак ставится в результате.
 */
export function splitBreakdown(entries: ReadonlyArray<BreakdownEntry>, shares: ReadonlyArray<number>,
    selected: ReadonlyArray<boolean>, sign: 1 | -1 = 1): BreakdownEntry[] {
    const total = shares.reduce((sum, share) => sum + share, 0);
    if (total === 0) return [];
    const difference = total - entries.reduce((sum, entry) => sum + entry.amount, 0);
    // Доли берутся из сводки, в том числе для исторических строк с недостающими реквизитами.
    const positions = difference === 0 ? entries : [...entries, { kind: 'missing', name: 'Не указан', amount: difference } as const];
    let remaining = [...shares];
    return positions.flatMap((entry, index) => {
        // Последняя позиция получает все оставшиеся копейки по каждому товару.
        const parts = index === positions.length - 1 ? remaining : allocate(entry.amount, remaining);
        remaining = remaining.map((share, index) => share - parts[index]!);
        const amount = parts.reduce((sum, part, index) => selected[index] ? sum + part : sum, 0) * sign;
        return amount === 0 ? [] : [{ ...entry, amount }];
    });
}
