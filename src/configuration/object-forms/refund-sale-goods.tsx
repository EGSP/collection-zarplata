import { RecordTablePart, useActionResult, useFormData, useFormValue, type RecordData, type TableLayouts } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Схемы таблицы товаров продажи. Таблица стоит под строкой основания и уже формы, поэтому
 * колонки объединены так же, как у товаров продажи на узком месте; с `xlg` они идут по одной.
 */
const saleGoodsLayouts: TableLayouts = {
    sm: [['code', 'name'], ['size', 'postedIn1C'], ['cost', 'discount'], 'total', ['comment', 'weighingLine']],
    xlg: ['code', 'name', 'size', 'postedIn1C', 'cost', 'discount', 'total', 'comment', 'weighingLine'],
};

/** Поля товара, по которым строка возврата признаётся копией строки продажи. */
const lineKey = (line: RecordData) => JSON.stringify([line.name, line.code, line.size ?? null, line.comment, line.cost, line.discount]);

/** Строка возврата из строки продажи: копия без отметки «Проведено в 1С». */
const copyOf = (row: RecordData, sale: string) => ({ name: row.name as string, code: row.code as string | null, size: (row.size ?? null) as string | null, comment: row.comment as string | null, postedIn1C: false, cost: row.cost as number, discount: row.discount as number | null, total: row.total as number, sale });

/**
 * Товары продажи под строкой основания возврата. Флажок у товара добавляет его копию в «Товары
 * на возврат» со ссылкой на продажу, снятие флажка убирает копию. Продажа при этом не меняется.
 * Флажок в заголовке отмечает и снимает все товары продажи, которые ещё можно вернуть.
 *
 * Товары, которые проведённые возвраты уже вернули (действие `returnedGoods`), залиты светло-серым,
 * и отметить их нельзя. Открытый на форме возврат в них не входит: его строки показывают флажки.
 *
 * Строка возврата не хранит номер исходной строки продажи, поэтому связь определяется по
 * содержимому: код, название, размер, комментарий, стоимость и скидка. Одинаковые строки продажи
 * считаются по порядку: сначала идут возвращённые ранее, затем отмеченные в этом возврате.
 * Если, например, в продаже три одинаковые куртки, одна уже возвращена, а в возврате отмечены
 * две копии, то первая строка серая, вторая и третья отмечены. Снятие флажка убирает последнюю
 * копию, а не ту, что стоит рядом с флажком; для одинаковых товаров это неразличимо.
 *
 * Копия переносит код, размер, комментарий, стоимость и скидку, итог форма пересчитывает сама. Отметка
 * «Проведено в 1С» снята: возврат является новым документом.
 */
export function RefundSaleGoods({ sale }: { readonly sale: string }) {
    const refunds = Objects.document.refund;
    const form = useFormData(refunds);
    const goods = useFormValue(refunds, 'goods');
    // Возвращённое ранее читает действие сервера; пока оно не ответило, считается, что ничего не возвращено.
    const returned = useActionResult<ReadonlyArray<RecordData>>({
        object: refunds, action: 'returnedGoods',
        payload: { sale, ...(form.saved === null ? {} : { excludedRefund: form.saved['guid'] }) },
    }).data ?? [];

    /** Номера строк продажи, которые уже возвращены: первые по порядку среди одинаковых. */
    const lockedRows = (rows: ReadonlyArray<RecordData>) => {
        const left = new Map<string, number>();
        for (const line of returned) left.set(lineKey(line), (left.get(lineKey(line)) ?? 0) + 1);
        return rows.flatMap((row, index) => {
            const count = left.get(lineKey(row)) ?? 0;
            if (count === 0) return [];
            left.set(lineKey(row), count - 1);
            return [index];
        });
    };
    /** Строки продажи, которые можно отметить, с их номерами. */
    const available = (rows: ReadonlyArray<RecordData>) => {
        const locked = new Set(lockedRows(rows));
        return rows.flatMap((row, index) => locked.has(index) ? [] : [{ row, index }]);
    };
    /** Сколько копий каждого товара уже есть в возврате по этой продаже. */
    const copies = (current: typeof goods) => {
        const counts = new Map<string, number>();
        for (const line of current) if (line.sale === sale) counts.set(lineKey(line), (counts.get(lineKey(line)) ?? 0) + 1);
        return counts;
    };
    /** Копии строк продажи, которых ещё нет в возврате; у одинаковых строк учитывается число копий. */
    const missing = (rows: ReadonlyArray<RecordData>, current: typeof goods) => {
        const counts = copies(current);
        return available(rows).flatMap(({ row }) => {
            const left = counts.get(lineKey(row)) ?? 0;
            if (left > 0) { counts.set(lineKey(row), left - 1); return []; }
            return [copyOf(row, sale)];
        });
    };

    return (
        <RecordTablePart
            object={Objects.document.sale}
            guid={sale}
            part="goods"
            layouts={saleGoodsLayouts}
            selection={{
                disabled: form.readOnly,
                locked: lockedRows,
                selected: (rows) => {
                    const counts = copies(goods);
                    const selected: number[] = [];
                    for (const { row, index } of available(rows)) {
                        const left = counts.get(lineKey(row)) ?? 0;
                        if (left === 0) continue;
                        counts.set(lineKey(row), left - 1);
                        selected.push(index);
                    }
                    return selected;
                },
                onToggleAll: (rows, checked) => {
                    // Флажок заголовка ставит или снимает отметки у всех доступных товаров. Прочие продажи возврата не затрагиваются.
                    form.setValue('goods', (current) => checked
                        ? [...current, ...missing(rows, current)]
                        : current.filter((line) => line.sale !== sale));
                },
                onToggle: (rows, index, checked) => {
                    const row = rows[index];
                    if (row === undefined) return;
                    // Строки вычисляются от текущего значения формы: при быстрых нажатиях подряд
                    // изменение по строкам прошлой отрисовки отменило бы предыдущее.
                    form.setValue('goods', (current) => {
                        if (checked) return [...current, copyOf(row, sale)];
                        const position = current.findLastIndex((line) => line.sale === sale && lineKey(line) === lineKey(row));
                        return position < 0 ? current : current.filter((_line, lineIndex) => lineIndex !== position);
                    });
                },
            }}
        />
    );
}
