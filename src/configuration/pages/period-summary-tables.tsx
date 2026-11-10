/**
 * Таблицы сводки за период: продажи и возвраты зоны 1С и итог «Всего». Строки плоские, по одной
 * на документ; связанные документы показывает раскрытая строка ссылками без сумм, поэтому каждый
 * рубль виден в итоге один раз (раздел «Правила учёта», «Сводка за период»).
 */
import { useState } from 'react';
import { DataTable, FieldDisplay, Icons, Panel, RecordLink, Stack, Text, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { SummaryAmounts, SummaryLink, SummaryOperation } from '../period-summary-operations';
import type { PaymentTotals, SummaryCertificateRow } from '../period-summary';
import { documentNumber, feedDate, feedGoods } from '../shell-components/seller-feed-format';

/** Денежная сумма в том же виде, что в формах. */
export function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/**
 * Таблица сводки показывает десять записей и прокручивается внутри: длинный день не растягивает
 * страницу. Заголовок и итоги закреплены, поэтому при прокрутке видны подписи колонок и суммы.
 */
export const summaryScroll = { visibleRows: 10, pinned: { header: true, summary: true } } as const;

/** Все деньги строки или итога: в сводке нет долга, поэтому сумма колонок фактическая. */
const totalOf = (amounts: SummaryAmounts) => amounts.cash + amounts.cashless + amounts.installment;

/**
 * Документ строки: значок вида, номер и дата. Значок уже отличает продажу от возврата, поэтому
 * слово вида не пишется. Товары стоят в соседней колонке.
 */
function OperationTitle({ row }: { readonly row: SummaryOperation }) {
    return <Text noWrap>{row.kind === 'sale' ? <Icons.sell /> : <Icons.refund />} № {documentNumber(row.number)} от {feedDate(row.date)}</Text>;
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
            // На узком экране документ и товары занимают первую линию, четыре суммы вторую.
            layouts={{ sm: [{ line: ['document', 'goods'] }, { line: ['cash', 'cashless', 'installment', 'total'] }], lg: [] }}
            {...summaryScroll}
            onRowClick={(row) => { void open(row.kind === 'sale' ? Objects.document.sale : Objects.document.refund, row.guid, 'tab'); }}
            expansion={{
                isExpandable: (row) => row.links.length > 0,
                isExpanded: (row) => expanded.has(row.key),
                onToggle: (row, _index, value) => setExpanded((previous) => { const next = new Set(previous); if (value) next.add(row.key); else next.delete(row.key); return next; }),
                render: (row) => <Stack gap={2}>{row.links.map((link) => <LinkLine key={`${link.kind}-${link.guid}-${link.date}`} link={link} />)}</Stack>,
            }}
            columns={[
                { key: 'document', title: 'Документ', type: 'free', size: { minimum: 22 }, render: (row) => <OperationTitle row={row} /> },
                // Товары сжимаются первыми: длинный список укорачивается многоточием, целиком он в подсказке.
                { key: 'goods', title: 'Товары', type: 'free', size: { minimum: 8, weight: 1 }, render: (row) => <Text ellipsis>{feedGoods(row.goods)}</Text> },
                { key: 'cash', title: 'Наличные', type: 'money', value: (row) => row.amounts.cash },
                { key: 'cashless', title: 'Безналичные', type: 'money', value: (row) => row.amounts.cashless },
                { key: 'installment', title: 'Рассрочка', type: 'money', value: (row) => row.amounts.installment },
                { key: 'total', title: 'Итого', type: 'money', value: (row) => totalOf(row.amounts) },
            ]}
            summary={{ document: <Text strong>Итого</Text>, cash: totals.cash, cashless: totals.cashless, installment: totals.installment, total: totalOf(totals) }}
        />
    );
}

/**
 * Покупки и обмены сертификатов периода. Покупка стоит номиналом со знаком плюс, обмен на деньги
 * строками обмена со знаком минус; сумма стоит в колонке способа. Итог под таблицей не входит во «Всего».
 */
export function CertificatesTable({ rows, totals }: { readonly rows: ReadonlyArray<SummaryCertificateRow>; readonly totals: PaymentTotals }) {
    return (
        <DataTable<SummaryCertificateRow>
            rowKey={(row) => `${row.kind}-${row.certificate}`}
            rows={rows}
            emptyText="Покупок и обменов сертификатов нет"
            layouts={{ sm: [{ line: [{ group: ['date', 'person'] }, 'certificate'] }, { line: ['cash', 'cashless'] }], lg: [] }}
            {...summaryScroll}
            columns={[
                { key: 'date', title: 'Дата', type: 'dateTime', render: (row) => <FieldDisplay field={{ kind: 'dateTime', target: null }} value={row.date} /> },
                { key: 'person', title: 'Держатель', type: 'free', size: { minimum: 12, weight: 1 }, render: (row) => <RecordLink reference={{ kind: 'catalog', name: 'physicalPersons', guid: row.person }} /> },
                { key: 'certificate', title: 'Сертификат', type: 'free', size: { minimum: 12, weight: 1 }, render: (row) => <Text noWrap>{row.kind === 'exchange' ? 'Обмен: ' : ''}<RecordLink reference={{ kind: 'document', name: 'certificate', guid: row.certificate }} /></Text> },
                { key: 'cash', title: 'Наличные', type: 'money', value: (row) => row.cash === 0 ? null : row.cash },
                { key: 'cashless', title: 'Безналичные', type: 'money', value: (row) => row.cashless === 0 ? null : row.cashless },
            ]}
            summary={{ date: <Text strong>Итого</Text>, cash: totals.cash, cashless: totals.cashless }}
        />
    );
}

/**
 * Итог «Всего» на рельсе: обе зоны и взносы, каждая сумма входит в него один раз. Ниже отдельной
 * строкой стоят сертификаты: их деньги во «Всего» не входят.
 */
export function SummaryTotalsPanel({ amounts, certificates }: { readonly amounts: SummaryAmounts; readonly certificates: PaymentTotals }) {
    return (
        <Panel title="Всего">
            <Stack gap={5}>
                <Text expressive noWrap>Наличные: <Money value={amounts.cash} /></Text>
                <Text expressive noWrap>Безналичные: <Money value={amounts.cashless} /></Text>
                <Text expressive noWrap>Рассрочка: <Money value={amounts.installment} /></Text>
                <Text expressive strong noWrap>Итого: <Money value={totalOf(amounts)} /></Text>
                <Text expressive noWrap>Сертификаты: <Money value={certificates.cash + certificates.cashless} /></Text>
            </Stack>
        </Panel>
    );
}
