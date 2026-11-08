/** Общее сопоставление возврата товарам продажи для денежных выдач и зон 1С в сводке. */
import { allocate } from './money-shares.js';

interface GoodsIdentity {
    readonly name: string;
    readonly code: string | null;
    readonly size: string | null;
    readonly comment: string | null;
    readonly cost: number;
    readonly discount: number | null;
    readonly total: number;
}

/** Повторяющиеся товары заполняются по порядку. Исправленные старые реквизиты не теряют сумму. */
export function refundGoodsWeights(originals: ReadonlyArray<GoodsIdentity>, returned: ReadonlyArray<GoodsIdentity>): number[] {
    const key = (line: GoodsIdentity) => JSON.stringify([line.name, line.code, line.size, line.comment, line.cost, line.discount]);
    const weights = originals.map(() => 0);
    let unmatched = 0;
    for (const line of returned) {
        let remaining = line.total;
        for (const [index, original] of originals.entries()) {
            if (key(original) !== key(line)) continue;
            const matched = Math.min(remaining, Math.max(0, original.total - weights[index]!));
            weights[index]! += matched;
            remaining -= matched;
            if (remaining === 0) break;
        }
        unmatched += remaining;
    }
    const available = originals.map((line, index) => Math.max(0, line.total - weights[index]!));
    const fallback = allocate(unmatched, available.some((amount) => amount > 0) ? available : originals.map((line) => line.total));
    return weights.map((value, index) => value + fallback[index]!);
}
