/**
 * Таблицы сводки за период: продажи и возвраты зоны 1С и итог «Всего». Строки плоские, по одной
 * на документ; связанные документы показывает раскрытая строка ссылками без сумм, поэтому каждый
 * рубль виден в итоге один раз (раздел «Правила учёта», «Сводка за период»).
 */
import { useState } from 'react';
import { DataTable, FieldDisplay, Icons, Panel, RecordLink, Stack, Text, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { SummaryAmounts, SummaryLink, SummaryOperation } from '../period-summary-operations';
import { documentNumber, feedDate, feedGoods } from '../shell-components/seller-feed-format';

/** Денежная сумма в том же виде, что в формах. */
export function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/** Все деньги строки или итога: в сводке нет долга, поэтому сумма колонок фактическая. */
const totalOf = (amounts: SummaryAmounts) => amounts.cash + amounts.cashless + amounts.installment;

/** Документ строки: значок, вид и номер, дата и товары зоны. */
function OperationTitle({ row }: { readonly row: SummaryOperation }) {
    const goods = feedGoods(row.goods);
    return (
        <Stack gap={2}>
            <Text noWrap>{row.kind === 'sale' ? <Icons.sell /> : <Icons.refund />} {row.kind === 'sale' ? 'Продажа' : 'Возврат'} № {documentNumber(row.number)} от {feedDate(row.date)}</Text>
            {goods !== '' && <Text.Helper>{goods}</Text.Helper>}
        </Stack>
    );
}

/** Связанный документ в раскрытой строке. У взноса ссылка ведёт на его рассрочку. */
function LinkLine({ link }: { readonly link: SummaryLink }) {
    if (link.kind === 'payment') {
        return <Text>Взнос от {feedDate(link.date)} по <RecordLink reference={{ kind: 'document', name: 'saleInstallment', guid: link.guid }} /></Text>;
    }
    return <Text><RecordLink reference={{ kind: 'document', name: link.kind, guid: link.guid }} /></Text>;
}

/**
 * Продажи и возвраты одной зоны 1С. Колонки «Наличные», «Безналичные», «Рассрочка» и «Итого»;
 * в «Рассрочку» попадает первоначальный взнос, чаще всего оплата банковской рассрочки. Щелчок
 * по строке открывает документ, Shift — его оригинал. Строка со связями раскрывается.
 */
export function OperationsTable({ rows, totals }: { readonly rows: ReadonlyArray<SummaryOperation>; readonly totals: SummaryAmounts }) {
    const open = useOpenRecord();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    return (
        <DataTable<SummaryOperation>
            rowKey={(row) => row.key}
            rows={rows}
            emptyText="Продаж и возвратов нет"
            layouts={{ sm: ['document', ['cash', 'cashless'], ['installment', 'total']], lg: [] }}
            onRowClick={(row) => { void open(row.kind === 'sale' ? Objects.document.sale : Objects.document.refund, row.guid, 'tab'); }}
            expansion={{
                isExpandable: (row) => row.links.length > 0,
                isExpanded: (row) => expanded.has(row.key),
                onToggle: (row, _index, value) => setExpanded((previous) => { const next = new Set(previous); if (value) next.add(row.key); else next.delete(row.key); return next; }),
                render: (row) => <Stack gap={2}>{row.links.map((link) => <LinkLine key={`${link.kind}-${link.guid}-${link.date}`} link={link} />)}</Stack>,
            }}
            columns={[
                { key: 'document', title: 'Документ и товары', type: 'free', size: { minimum: 24, weight: 1 }, render: (row) => <OperationTitle row={row} /> },
                { key: 'cash', title: 'Наличные', type: 'money', value: (row) => row.amounts.cash },
                { key: 'cashless', title: 'Безналичные', type: 'money', value: (row) => row.amounts.cashless },
                { key: 'installment', title: 'Рассрочка', type: 'money', value: (row) => row.amounts.installment },
                { key: 'total', title: 'Итого', type: 'money', value: (row) => totalOf(row.amounts) },
            ]}
            summary={{ document: <Text strong>Итого</Text>, cash: totals.cash, cashless: totals.cashless, installment: totals.installment, total: totalOf(totals) }}
        />
    );
}

/** Итог «Всего» на рельсе: обе зоны и взносы. Каждая сумма входит в него один раз. */
export function SummaryTotalsPanel({ amounts }: { readonly amounts: SummaryAmounts }) {
    return (
        <Panel title="Всего">
            <Stack gap={5}>
                <Text expressive noWrap>Наличные: <Money value={amounts.cash} /></Text>
                <Text expressive noWrap>Безналичные: <Money value={amounts.cashless} /></Text>
                <Text expressive noWrap>Рассрочка: <Money value={amounts.installment} /></Text>
                <Text expressive strong noWrap>Итого: <Money value={totalOf(amounts)} /></Text>
            </Stack>
        </Panel>
    );
}
