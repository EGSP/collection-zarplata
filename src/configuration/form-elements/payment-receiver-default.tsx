/** Клиентская подстановка приёмника. Сервер по-прежнему проверяет обязательность поля. */
import { useEffect, useRef } from 'react';
import { useActionResult, useObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Поля оплаты, которые участвуют в подстановке. Остальные поля строки сохраняются буквально. */
interface Payment {
    readonly method: string | null;
    readonly receiver?: unknown;
}

/** Составные значения сравниваются по содержимому: форма может заново создать объект ссылки. */
const same = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * Наблюдает одну оплату. Только новая оплата заполняется при первом появлении; сохранённая
 * начинает следовать правилу после выбора способа. Последнюю автоматическую ссылку храним
 * отдельно, чтобы отличать её от текста и другого приёмника, выбранных продавцом.
 */
export function PaymentReceiverDefault({ method, receiver, initialize, disabled = false, onChange }: Payment & {
    readonly initialize: boolean;
    readonly disabled?: boolean;
    readonly onChange: (receiver: unknown) => void;
}) {
    const view = useObjectView(Objects.catalog.paymentReceivers);
    const result = useActionResult<{ readonly items: ReadonlyArray<{ readonly guid: string; readonly paymentMethod: string | null }> }>({
        object: Objects.catalog.paymentReceivers,
        action: 'list',
        enabled: !disabled && view !== undefined && method !== null && method !== 'Рассрочка',
        payload: {
            filter: [{ field: 'paymentMethod', operator: 'equals', value: method }, { field: 'deletedAt', operator: 'equals', value: null }],
            sort: view?.list?.defaultSort ?? [], page: 1, pageSize: 1,
        },
    });
    const previous = useRef(method);
    const automatic = useRef<unknown>(null);
    const pending = useRef(initialize);
    useEffect(() => {
        if (disabled) return;
        if (previous.current !== method) {
            previous.current = method;
            pending.current = receiver == null || (automatic.current !== null && same(receiver, automatic.current));
            if (method === 'Рассрочка') {
                pending.current = false;
                automatic.current = null;
                if (receiver != null) onChange(null);
                return;
            }
            // Прежний автоматический приёмник убирается и при отсутствии нового соответствия.
            if (pending.current && receiver != null) {
                automatic.current = null;
                onChange(null);
                return;
            }
        }
        // Ручной ввод до окончания запроса отменяет отложенную подстановку этого выбора способа.
        if (receiver != null) pending.current = false;
        if (!pending.current || method === null || method === 'Рассрочка') return;
        const first = result.data?.items[0];
        // Кеш может временно вернуть ответ прежнего способа. Такой ответ не заполняет поле.
        if (first === undefined || first.paymentMethod !== method || view === undefined) return;
        const reference = { type: 'reference', kind: 'catalog', name: 'paymentReceivers', guid: first.guid };
        pending.current = false;
        automatic.current = reference;
        onChange(reference);
    }, [method, receiver, result.data, view, disabled, onChange]);
    return null;
}

/**
 * Стабильные ключи оплат сохраняют историю подстановки при удалении соседней строки.
 * Сначала узнаём неизменные строки, затем связываем изменённую строку с прежней позицией.
 * При удалении строки оставшиеся строки узнаются по полному содержимому.
 */
export function PaymentReceiverDefaults<Row extends Payment>({ rows, initialize, disabled, onChange }: {
    readonly rows: ReadonlyArray<Row>;
    readonly initialize: boolean;
    readonly disabled: boolean;
    readonly onChange: (index: number, receiver: unknown) => void;
}) {
    const sequence = useRef(0);
    const previous = useRef<ReadonlyArray<{ readonly row: Row; readonly key: number; readonly initialize: boolean }> | null>(null);
    const unused = [...previous.current ?? []];
    const entries = rows.map((row, index) => {
        let found = unused.findIndex((entry) => same(entry.row, row));
        if (found < 0 && previous.current?.length === rows.length) found = unused.findIndex((entry) => entry.key === previous.current?.[index]?.key);
        const before = found < 0 ? undefined : unused.splice(found, 1)[0];
        return { row, key: before?.key ?? sequence.current++, initialize: before?.initialize ?? (previous.current === null ? initialize : true) };
    });
    previous.current = entries;
    return <>{entries.map(({ row, key, initialize: initial }, index) => <PaymentReceiverDefault key={key} {...row}
        initialize={initial} disabled={disabled} onChange={(receiver) => onChange(index, receiver)} />)}</>;
}
