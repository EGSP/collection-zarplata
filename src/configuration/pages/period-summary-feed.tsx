/** Производная фида для сводки: связанные документы и единый ряд денежных колонок. */
import { theme } from 'antd';
import { FeedTable, FeedTableDescription, FieldDisplay, Icons, Panel, Stack, Text, useOpenRecord } from '../../web/sdk';
import type { SummaryAmounts, SummaryOperation } from '../period-summary-operations';
import { Objects } from '../objects.generated';
import { documentNumber, feedDate, feedGoods } from '../shell-components/seller-feed-format';

const Money = ({ value }: { readonly value: number }) => <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
const received = (amounts: SummaryAmounts) => amounts.cash + amounts.cashless + amounts.bank + amounts.advance;

/** В строке и итого основная сумма единообразна; Expressive включается только у ключевых показателей. */
export function SummaryTotal({ amounts, compact = false, expressive = false }: { readonly amounts: SummaryAmounts; readonly compact?: boolean; readonly expressive?: boolean }) {
    return <Stack gap={2} align={compact ? 'flex-end' : 'flex-start'}>
        <Text expressive={expressive} noWrap>{!compact && 'Получено: '}<Money value={received(amounts)} /></Text>
        {(!compact || amounts.debt !== 0) && <Text.Helper expressive={expressive} noWrap>С рассрочками: <Money value={received(amounts) + amounts.debt} /></Text.Helper>}
    </Stack>;
}

/** Собственная рассрочка показывается полной суммой, взносы не вычитаются. */
function InstallmentAmounts({ amounts, summary = false, expressive = false, align = 'flex-end', label = false, names = false }: {
    readonly amounts: SummaryAmounts; readonly summary?: boolean; readonly expressive?: boolean; readonly align?: 'flex-start' | 'flex-end'; readonly label?: boolean; readonly names?: boolean;
}) {
    return <Stack gap={2} align={align}>
        <Text expressive={expressive} noWrap>{label && 'Рассрочка: '}<Money value={amounts.bank + amounts.own} /></Text>
        {(summary || amounts.bank !== 0) && <Text.Helper expressive={expressive} noWrap><span title="Банковская" aria-label="Банковская"><Icons.bankInstallment /></span> {names && 'Банковская: '}<Money value={amounts.bank} /></Text.Helper>}
        {(summary || amounts.own !== 0) && <Text.Helper expressive={expressive} noWrap><span title="Собственная" aria-label="Собственная"><Icons.ownInstallment /></span> {names && 'Собственная: '}<Money value={amounts.own} /></Text.Helper>}
    </Stack>;
}

/** Общий вертикальный вид: ключевые показатели страницы и компактный итог каждого списка. */
function SummaryTotalsContent({ amounts, expressive = false, inFeed = false }: { readonly amounts: SummaryAmounts; readonly expressive?: boolean; readonly inFeed?: boolean }) {
    return <Stack gap={5}>
        <Text expressive={expressive} noWrap>Наличные: <Money value={amounts.cash} /></Text>
        <Text expressive={expressive} noWrap>Безналичные: <Money value={amounts.cashless} /></Text>
        <InstallmentAmounts amounts={amounts} summary expressive={expressive} align="flex-start" label={!inFeed} names={!inFeed} />
        <SummaryTotal amounts={amounts} expressive={expressive} />
    </Stack>;
}

/** Ключевые показатели крупнее строк списка. Долги остаются в таблице рассрочек. */
export function SummaryTotalsPanel({ amounts }: { readonly amounts: SummaryAmounts }) {
    return <Panel title="Всего"><SummaryTotalsContent amounts={amounts} expressive /></Panel>;
}

export function PeriodSummaryFeed({ title, rows, totals }: { readonly title: string; readonly rows: ReadonlyArray<SummaryOperation>; readonly totals: SummaryAmounts }) {
    const { token } = theme.useToken();
    const open = useOpenRecord();
    return <FeedTable<SummaryOperation> label={title} rows={rows} rowKey={(row) => row.key} childrenOf={(row) => row.children} isContext={(row) => row.context}
        compactSummary={<Stack gap={4}><Text strong>Итого</Text><SummaryTotalsContent amounts={totals} inFeed /></Stack>}
        appearance={(row) => ({ background: row.context ? token.colorFillTertiary : row.kind === 'sale' ? token.cyan1 : token.magenta1,
            hover: row.kind === 'sale' ? token.cyan2 : token.magenta2,
            label: `${row.kind === 'sale' ? 'Продажа' : 'Возврат'} ${documentNumber(row.number)}` })}
        onOpen={(row, event) => { void open(row.kind === 'sale' ? Objects.document.sale : Objects.document.refund, row.guid, 'tab', { original: event.shiftKey }); }}
        columns={[
            { key: 'document', title: 'Документы и товары', type: 'free', size: { minimum: 24, weight: 1 }, summary: <Text>Итого</Text>, render: (row) => <FeedTableDescription
                icon={row.kind === 'sale' ? <Icons.sell /> : <Icons.refund />}
                title={`№ ${documentNumber(row.number)}`}
                date={feedDate(row.date)} goods={feedGoods(row.goods)}
                {...(row.context ? { note: 'Продажа другого периода, только для связи' } : {})} /> },
            { key: 'cash', title: 'Наличные', type: 'money', summary: <Text noWrap><Money value={totals.cash} /></Text>, render: (row) => <Text noWrap><Money value={row.amounts.cash} /></Text> },
            { key: 'cashless', title: 'Безналичные', type: 'money', summary: <Text noWrap><Money value={totals.cashless} /></Text>, render: (row) => <Text noWrap><Money value={row.amounts.cashless} /></Text> },
            { key: 'installment', title: 'Рассрочка', type: 'money', size: { minimum: 16 }, summary: <InstallmentAmounts amounts={totals} summary />, render: (row) => <InstallmentAmounts amounts={row.amounts} /> },
            { key: 'total', title: 'Получено', type: 'money', size: { minimum: 17 }, summary: <SummaryTotal amounts={totals} compact />, render: (row) => <SummaryTotal amounts={row.amounts} compact /> },
        ]} />;
}
