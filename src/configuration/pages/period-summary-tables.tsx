/** Таблицы продаж, возвратов и сертификатов и блок «Всего» обеих сводок. */
import { useState, type ReactNode } from 'react';
import { Column, DataTable, Divider, FieldDisplay, Grid, Icons, Layer, Panel, RecordLink, Stack, Text, spacing, useBreakpoint, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { SummaryAmounts, SummaryLink, SummaryOperation, SummaryTotals } from '../period-summary-operations';
import type { PaymentTotals, PeriodSummary, SummaryCertificateRow } from '../period-summary';
import type { SummaryBreakdown } from '../summary-breakdown';
import { documentNumber, feedDate, feedGoods } from '../shell-components/seller-feed-format';
import { Money, SummaryBreakdownList } from './summary-breakdown-list';

/**
 * Компоновка таблицы сводки с `md`: десять записей и прокрутка внутри, длинный день не растягивает
 * страницу; заголовок и итоги закреплены у краёв таблицы, при прокрутке видны подписи колонок
 * и суммы. На `sm` действуют значения платформы: строки развёрнуты, делятся на страницы
 * и не закрепляются.
 */
export const summaryLayout = { overflow: { mode: 'scroll', rows: 10 }, pinned: { header: true, summary: true } } as const;

/**
 * Вид сводки. `period` — сводка за период: только фактические деньги. `cash` — кассовая сводка:
 * «Рассрочка» содержит долг собственной рассрочки, а у возвратов — его погашение.
 */
export type SummaryVariant = 'period' | 'cash';

/**
 * «Итого» строки или итога — сумма колонок. В сводке за период это полученные деньги: долга в ней
 * нет. В кассовой сводке — сумма, как в кассовом чеке, вместе с долгом рассрочки.
 */
const totalOf = (amounts: SummaryAmounts) => amounts.cash + amounts.cashless + amounts.installment;

/** Для подстроки перечисляет только денежные колонки, сохраняя пустые ячейки под документом и товарами. */
function breakdownCells(breakdown: SummaryBreakdown, showTotal = true) {
    return {
        cash: <SummaryBreakdownList inTable entries={breakdown.cash} />,
        cashless: <SummaryBreakdownList inTable entries={breakdown.cashless} />,
        installment: <SummaryBreakdownList inTable entries={breakdown.installment} />,
        total: showTotal ? <SummaryBreakdownList inTable entries={breakdown.total} /> : undefined,
    };
}

/** На узкой схеме название итога помещается над наличными, а суммы остаются на одной высоте. */
function CompactTotalAmount({ title, value }: { readonly title?: string; readonly value: number }) {
    return (
        <div style={{ alignSelf: 'flex-end', paddingBlock: spacing[2] }}>
            <Stack gap={1}>
                {title && <Text.Label>{title}</Text.Label>}
                <Text strong noWrap><Money value={value} /></Text>
            </Stack>
        </div>
    );
}

/** Строит денежную линию итогов, сохраняя выравнивание по колонкам обеих схем. */
function cashAmountCells(title: string, amounts: SummaryAmounts, compact: boolean) {
    if (compact) {
        return {
            cash: <CompactTotalAmount title={title} value={amounts.cash} />,
            cashless: <CompactTotalAmount value={amounts.cashless} />,
            installment: <CompactTotalAmount value={amounts.installment} />,
            total: <CompactTotalAmount value={totalOf(amounts)} />,
        };
    }
    return { document: title, cash: amounts.cash, cashless: amounts.cashless, installment: amounts.installment, total: totalOf(amounts) };
}

/**
 * Две подстроки в ячейке строки итогов: «Продажи» сверху и «Возвраты» под пунктиром. Строка итогов
 * у таблицы одна, поэтому подстроки рисует ячейка, а не таблица. Пустая подстрока сохраняет высоту,
 * чтобы значения соседних колонок стояли на одной линии.
 */
function SummaryLines({ sales, refunds }: { readonly sales: ReactNode; readonly refunds: ReactNode }) {
    return (
        // Стек занимает всю ячейку: пунктир идёт от края до края, как граница подстрок таблицы.
        <Stack gap={2} align="stretch" grow>
            <Text strong noWrap>{sales}</Text>
            <Divider dashed />
            <Text strong noWrap>{refunds ?? <>&nbsp;</>}</Text>
        </Stack>
    );
}

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
 * Продажи и возвраты периода или одной кассовой зоны 1С. Расшифровка идёт под суммами документа.
 * В строке итогов периода стоят суммы «Продажи» и «Возвраты», расшифровка этих итогов видна в «Всего».
 * У кассы расшифровка есть и в итогах таблицы, а «Рассрочка» у возврата показывает погашение долга.
 */
export function OperationsTable({ rows, totals, variant = 'period' }: { readonly rows: ReadonlyArray<SummaryOperation>; readonly totals: SummaryTotals; readonly variant?: SummaryVariant }) {
    const open = useOpenRecord();
    const compact = useBreakpoint() === 'sm';
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const cashReport = variant === 'cash';
    const breakdown = cashReport ? totals.breakdown : undefined;
    return (
        <DataTable<SummaryOperation>
            rowKey={(row) => row.key}
            rows={rows}
            emptyText="Продаж и возвратов нет"
            // На узком экране документ и товары занимают первую линию, четыре суммы вторую.
            layouts={{ sm: { lines: [{ line: ['document', 'goods'] }, { line: ['cash', 'cashless', 'installment', 'total'] }] }, md: summaryLayout, lg: { lines: [] } }}
            subrow={totals.breakdown === undefined ? undefined : (row) => {
                if (row.breakdown === undefined || (!cashReport && row.breakdown.total.length === 0)) return undefined;
                return breakdownCells(row.breakdown, cashReport);
            }}
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
            summary={breakdown !== undefined ? [
                cashAmountCells('Продажи', totals.sales, compact),
                breakdownCells(breakdown.sales),
                cashAmountCells('Возвраты', totals.refunds, compact),
                breakdownCells(breakdown.refunds),
            ] : {
                document: <SummaryLines sales="Продажи" refunds="Возвраты" />,
                cash: <SummaryLines sales={<Money value={totals.sales.cash} />} refunds={<Money value={totals.refunds.cash} />} />,
                cashless: <SummaryLines sales={<Money value={totals.sales.cashless} />} refunds={<Money value={totals.refunds.cashless} />} />,
                // В сводке за период возврат рассрочку деньгами не выдаёт: у возвратов эта подстрока пустая.
                // В кассе в ней стоит погашение долга возвратами по продажам других дней.
                installment: <SummaryLines sales={<Money value={totals.sales.installment} />} refunds={variant === 'cash' ? <Money value={totals.refunds.installment} /> : null} />,
                total: <SummaryLines sales={<Money value={totalOf(totals.sales)} />} refunds={<Money value={totalOf(totals.refunds)} />} />,
            }}
        />
    );
}

/**
 * Держатель сертификата: физическое лицо ссылкой на его карточку, держатель-строка своим текстом.
 * У строки карточки нет, поэтому и ссылки нет.
 */
function CertificateHolderText({ holder }: { readonly holder: SummaryCertificateRow['holder'] }) {
    return holder.type === 'reference'
        ? <RecordLink reference={{ kind: 'catalog', name: 'physicalPersons', guid: holder.guid }} />
        : <>{holder.value}</>;
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
            subrow={(row) => ({
                cash: <SummaryBreakdownList inTable entries={row.breakdown.cash} />,
                cashless: <SummaryBreakdownList inTable entries={row.breakdown.cashless} />,
            })}
            layouts={{ sm: { lines: [{ line: [{ group: ['date', 'holder'] }, 'certificate'] }, { line: ['cash', 'cashless'] }] }, md: summaryLayout, lg: { lines: [] } }}
            columns={[
                { key: 'date', title: 'Дата', type: 'dateTime', render: (row) => <FieldDisplay field={{ kind: 'dateTime', target: null }} value={row.date} /> },
                { key: 'holder', title: 'Держатель', type: 'free', size: { minimum: 12, weight: 1 }, render: (row) => <CertificateHolderText holder={row.holder} /> },
                { key: 'certificate', title: 'Сертификат', type: 'free', size: { minimum: 12, weight: 1 }, render: (row) => <Text noWrap>{row.kind === 'exchange' ? 'Обмен: ' : ''}<RecordLink reference={{ kind: 'document', name: 'certificate', guid: row.certificate }} /></Text> },
                { key: 'cash', title: 'Наличные', type: 'money', value: (row) => row.cash === 0 ? null : row.cash },
                { key: 'cashless', title: 'Безналичные', type: 'money', value: (row) => row.cashless === 0 ? null : row.cashless },
            ]}
            summary={{ date: <Text strong>Итого</Text>, cash: totals.cash, cashless: totals.cashless }}
        />
    );
}

/** Деньги по способам и итог одного блока «Всего». У кассы «Итого» тоже раскрывается по приёмникам. */
function TotalsLines({ amounts, installment, breakdown, showTotalBreakdown = false }: {
    readonly amounts: SummaryAmounts;
    readonly installment: boolean;
    readonly breakdown?: SummaryBreakdown | undefined;
    readonly showTotalBreakdown?: boolean;
}) {
    const lines = [
        { title: 'Наличные', amount: amounts.cash, entries: breakdown?.cash },
        { title: 'Безналичные', amount: amounts.cashless, entries: breakdown?.cashless },
        ...(installment ? [{ title: 'Рассрочка', amount: amounts.installment, entries: breakdown?.installment }] : []),
        { title: 'Итого', amount: totalOf(amounts), entries: showTotalBreakdown ? breakdown?.total : undefined },
    ];
    return (
        <>
            {lines.map(({ title, amount, entries }) => (
                <Stack key={title} gap={2}>
                    <Text typeSet="expressive" strong={title === 'Итого'} noWrap>{title}: <Money value={amount} /></Text>
                    {entries !== undefined && <SummaryBreakdownList entries={entries} />}
                </Stack>
            ))}
        </>
    );
}

/** Блок панели «Всего»: подпись и суммы на поверхности следующего уровня, отдельно от соседних блоков. */
function TotalsTile({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return (
        <Layer padding={4}>
            <Stack gap={3}>
                <Text.Heading variant="02">{title}</Text.Heading>
                {children}
            </Stack>
        </Layer>
    );
}

/** Итоги продаж и возвратов стоят рядом, их сумма ниже. Деньги сертификатов имеют свой итог. */
export function SummaryTotalsPanel({ totals, certificates, variant = 'period' }: {
    readonly totals: SummaryTotals;
    readonly certificates?: PeriodSummary['certificates'];
    readonly variant?: SummaryVariant;
}) {
    const cashReport = variant === 'cash';
    return (
        <Panel title="Всего">
            <Grid gutter="narrow">
                <Column span={{ md: 4, lg: 8 }}>
                    <TotalsTile title="Продажи"><TotalsLines amounts={totals.sales} installment breakdown={totals.breakdown?.sales} showTotalBreakdown={cashReport} /></TotalsTile>
                </Column>
                <Column span={{ md: 4, lg: 8 }}>
                    <TotalsTile title="Возвраты"><TotalsLines amounts={totals.refunds} installment={variant === 'cash'} breakdown={totals.breakdown?.refunds} showTotalBreakdown={cashReport} /></TotalsTile>
                </Column>
                <Column>
                    <TotalsTile title="Общий"><TotalsLines amounts={totals.all} installment breakdown={totals.breakdown?.all} showTotalBreakdown={cashReport} /></TotalsTile>
                </Column>
                {certificates !== undefined && (
                    <Column>
                        {certificates.rows.length === 0 ? (
                            <Text typeSet="expressive" noWrap>Сертификаты: <Money value={0} /></Text>
                        ) : (
                            <TotalsTile title="Сертификаты">
                                <TotalsLines amounts={{ ...certificates.totals, installment: 0 }} installment={false} breakdown={certificates.breakdown} />
                            </TotalsTile>
                        )}
                    </Column>
                )}
            </Grid>
        </Panel>
    );
}
