/**
 * Таблицы сводки за период: продажи и возвраты зоны 1С и итог «Всего». Строки плоские, по одной
 * на документ; связанные документы показывает раскрытая строка ссылками без сумм, поэтому каждый
 * рубль виден в итоге один раз (раздел «Правила учёта», «Сводка за период»).
 *
 * Итоги делят возвраты по дням продаж: возврат в день продажи вычтен из продаж, возвраты продаж
 * других дней стоят отдельно. Так видно, сколько принесли продажи периода и сколько ушло на возвраты
 * прошлых продаж.
 */
import { useState, type ReactNode } from 'react';
import { Column, DataTable, Divider, FieldDisplay, Grid, Icons, Layer, Panel, RecordLink, Stack, Text, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { SummaryAmounts, SummaryLink, SummaryOperation, SummaryRefundAmounts, SummaryTotals } from '../period-summary-operations';
import type { PaymentTotals, SummaryCertificateRow } from '../period-summary';
import { documentNumber, feedDate, feedGoods } from '../shell-components/seller-feed-format';

/** Денежная сумма в том же виде, что в формах. */
export function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/**
 * Компоновка таблицы сводки с `md`: десять записей и прокрутка внутри, длинный день не растягивает
 * страницу; заголовок и итоги закреплены у краёв таблицы, при прокрутке видны подписи колонок
 * и суммы. На `sm` действуют значения платформы: строки развёрнуты, делятся на страницы
 * и не закрепляются.
 */
export const summaryLayout = { overflow: { mode: 'scroll', rows: 10 }, pinned: { header: true, summary: true } } as const;

/** Все деньги строки или итога: в сводке нет долга, поэтому сумма колонок фактическая. */
const totalOf = (amounts: SummaryAmounts) => amounts.cash + amounts.cashless + amounts.installment;
/** Все деньги возвратов: рассрочку возврат деньгами не выдаёт. */
const refundTotalOf = (amounts: SummaryRefundAmounts) => amounts.cash + amounts.cashless;

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
 * Продажи и возвраты одной зоны 1С. Колонки «Наличные», «Безналичные», «Рассрочка» и «Итого»;
 * в «Рассрочку» попадает первоначальный взнос, чаще всего оплата банковской рассрочки. Щелчок
 * по строке открывает документ, Shift — его оригинал. Строка со связями раскрывается.
 *
 * Итогов две строки: «Продажи» за вычетом возвратов в день продажи и «Возвраты» по продажам
 * других дней. Строки документов показывают деньги целиком, как и раньше.
 */
export function OperationsTable({ rows, totals }: { readonly rows: ReadonlyArray<SummaryOperation>; readonly totals: SummaryTotals }) {
    const open = useOpenRecord();
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    return (
        <DataTable<SummaryOperation>
            rowKey={(row) => row.key}
            rows={rows}
            emptyText="Продаж и возвратов нет"
            // На узком экране документ и товары занимают первую линию, четыре суммы вторую.
            layouts={{ sm: { lines: [{ line: ['document', 'goods'] }, { line: ['cash', 'cashless', 'installment', 'total'] }] }, md: summaryLayout, lg: { lines: [] } }}
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
            summary={{
                document: <SummaryLines sales="Продажи" refunds="Возвраты" />,
                cash: <SummaryLines sales={<Money value={totals.sales.cash} />} refunds={<Money value={totals.refunds.cash} />} />,
                cashless: <SummaryLines sales={<Money value={totals.sales.cashless} />} refunds={<Money value={totals.refunds.cashless} />} />,
                // Возврат рассрочку деньгами не выдаёт: у возвратов эта подстрока пустая.
                installment: <SummaryLines sales={<Money value={totals.sales.installment} />} refunds={null} />,
                total: <SummaryLines sales={<Money value={totalOf(totals.sales)} />} refunds={<Money value={refundTotalOf(totals.refunds)} />} />,
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

/** Деньги по способам и итог одного блока панели «Всего». Рассрочку показывает только блок, где она есть. */
function TotalsLines({ amounts, installment }: { readonly amounts: SummaryRefundAmounts; readonly installment?: number | undefined }) {
    return (
        <>
            <Text typeSet="expressive" noWrap>Наличные: <Money value={amounts.cash} /></Text>
            <Text typeSet="expressive" noWrap>Безналичные: <Money value={amounts.cashless} /></Text>
            {installment !== undefined && <Text typeSet="expressive" noWrap>Рассрочка: <Money value={installment} /></Text>}
            <Text typeSet="expressive" strong noWrap>Итого: <Money value={refundTotalOf(amounts) + (installment ?? 0)} /></Text>
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

/**
 * Итог «Всего»: обе зоны и взносы, каждая сумма входит в него один раз. Три блока:
 *
 * 1. «Продажи» — продажи и взносы за вычетом возвратов в день продажи.
 * 2. «Возвраты» — возвраты по продажам других дней.
 * 3. «Общий» — полная сумма с учётом всех возвратов.
 *
 * Блоки стоят в собственной сетке панели. Обычная (не `subgrid`) сетка считает точки перелома
 * по своей ширине, поэтому странице раскладку описывать не нужно: на узком рельсе панель
 * получает `sm` и блоки встают столбиком, на всю ширину под таблицами — `md` и шире.
 * Три блока не делят 8 или 16 колонок поровну, поэтому «Продажи» и «Возвраты» стоят рядом
 * по половине строки, а «Общий», их сумма, — строкой ниже на всю ширину.
 *
 * Ниже на всю ширину стоят сертификаты: их деньги во «Всего» не входят.
 */
export function SummaryTotalsPanel({ totals, certificates }: { readonly totals: SummaryTotals; readonly certificates: PaymentTotals }) {
    return (
        <Panel title="Всего">
            <Grid gutter="narrow">
                <Column span={{ md: 4, lg: 8 }}>
                    <TotalsTile title="Продажи"><TotalsLines amounts={totals.sales} installment={totals.sales.installment} /></TotalsTile>
                </Column>
                <Column span={{ md: 4, lg: 8 }}>
                    <TotalsTile title="Возвраты"><TotalsLines amounts={totals.refunds} /></TotalsTile>
                </Column>
                <Column>
                    <TotalsTile title="Общий"><TotalsLines amounts={totals.all} installment={totals.all.installment} /></TotalsTile>
                </Column>
                <Column>
                    <Text typeSet="expressive" noWrap>Сертификаты: <Money value={certificates.cash + certificates.cashless} /></Text>
                </Column>
            </Grid>
        </Panel>
    );
}
