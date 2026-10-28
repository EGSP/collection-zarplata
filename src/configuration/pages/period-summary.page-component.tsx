import { Alert, Button, ConfigProvider, Divider, Flex, Table, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Column, FieldDisplay, FieldInput, FluidField, Grid, Layer, Page, Panel, RecordLink, spacing, Stack, Text, useActionResult, useLayer, useRecordList, type AccountingTone } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { PaymentTotals, PeriodSummary, SummaryGoodsBlock } from '../period-summary';

/** Сегодняшний день датой `ГГГГ-ММ-ДД` по часам браузера: отчёт по умолчанию строится за него. */
function today(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Следующий день даты `ГГГГ-ММ-ДД`. Считается в UTC, как на сервере, чтобы переход на летнее время не сдвигал день. */
function nextDay(day: string): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
}

/** Поле дня периода: дата без времени. */
const dayField = { kind: 'date', target: null } as const;

/** Денежная сумма в том же виде, что в формах. */
function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/** Дата и время события. */
function Moment({ value }: { readonly value: string }) {
    return <FieldDisplay field={{ kind: 'dateTime', target: null }} value={value} />;
}

/** Ссылка на документ или физическое лицо по имени объекта. */
function Reference({ kind, name, guid }: { readonly kind: 'catalog' | 'document'; readonly name: string; readonly guid: string | null }) {
    return guid === null ? null : <RecordLink reference={{ kind, name, guid }} />;
}

/** Ячейка итоговой строки таблицы. */
function SummaryCell({ index, children, align }: { readonly index: number; readonly children?: ReactNode; readonly align?: 'right' }) {
    return <Table.Summary.Cell index={index} {...(align === undefined ? {} : { align })}><Typography.Text strong>{children}</Typography.Text></Table.Summary.Cell>;
}

/** Блок отчёта: заголовок и содержимое; пустой блок сообщает, что строк нет. */
function Block({ title, empty, children }: { readonly title: string; readonly empty: boolean; readonly children: ReactNode }) {
    return (
        <Panel title={title}>
            {empty ? <Typography.Text type="secondary">Строк нет</Typography.Text> : children}
        </Panel>
    );
}

/**
 * Сумма в рассрочку, ещё не погашенная целиком: жирная, цвета долга. Так в колонке видно,
 * у каких продаж рассрочка не закрыта, а в итоге — полная сумма в рассрочку без учёта взносов.
 */
function OpenInstallment({ value }: { readonly value: number }) {
    return <Text tone="debt" strong><Money value={value} /></Text>;
}

/** Непогашенная часть долга должника: цвета долга, как незакрытая рассрочка выше. */
function Debt({ value }: { readonly value: number }) {
    return <Text tone="debt"><Money value={value} /></Text>;
}

/** Ячейка из двух строк: основное значение и пояснение под ним. */
function TwoLines({ first, second }: { readonly first: ReactNode; readonly second: ReactNode }) {
    return (
        <Flex vertical align="flex-end">
            <span style={{ whiteSpace: 'nowrap' }}>{first}</span>
            <Text.Helper noWrap>{second}</Text.Helper>
        </Flex>
    );
}

/**
 * Итог в рассрочку: полная сумма и внесённая часть под ней. Полная сумма выделена: она не учитывает
 * взносы, и её нельзя принять за полученные деньги.
 */
function InstallmentTotal({ total, paid }: { readonly total: number; readonly paid: number }) {
    return <TwoLines first={<OpenInstallment value={total} />} second={<>внесено <Money value={paid} /></>} />;
}

/** Итог всех оплат: полная сумма и сумма, в которой от рассрочки учтена только внесённая часть. */
function GrandTotal({ total, totals, paid }: { readonly total: number; readonly totals: PaymentTotals; readonly paid: number }) {
    return <TwoLines first={<Money value={total} />} second={<>с внесённым <Money value={totals.cash + totals.cashless + paid} /></>} />;
}

/** Строка с суммами по способам оплаты; у товара продажи есть ещё признак незакрытой рассрочки. */
interface PaymentRow {
    readonly payments: PaymentTotals;
    readonly installmentOpen?: boolean;
}

/** Колонки сумм по способам оплаты. Сумма в рассрочку с незакрытой рассрочкой выделена. */
const paymentColumns = <Row extends PaymentRow>() => [
    { title: 'Наличные', key: 'cash', align: 'right' as const, render: (_value: unknown, row: Row) => <Money value={row.payments.cash} /> },
    { title: 'Безналичные', key: 'cashless', align: 'right' as const, render: (_value: unknown, row: Row) => <Money value={row.payments.cashless} /> },
    {
        title: 'В рассрочку', key: 'installment', align: 'right' as const,
        render: (_value: unknown, row: Row) => row.installmentOpen === true ? <OpenInstallment value={row.payments.installment} /> : <Money value={row.payments.installment} />,
    },
];

/**
 * Зона продаж с заливкой: подзаголовок и таблица на одной поверхности. Без `tone` зона берёт фон
 * следующего уровня и отличается от панели серым; со смысловым цветом залита им.
 */
function FilledZone({ title, tone, empty, children }: { readonly title: string; readonly tone?: AccountingTone; readonly empty: boolean; readonly children: ReactNode }) {
    return (
        <Layer padding={4} {...(tone === undefined ? {} : { tone })}>
            <Flex vertical gap={spacing[3]}>
                <Text strong>{title}</Text>
                {empty ? <Text tone="secondary">Строк нет</Text> : <ZoneTable>{children}</ZoneTable>}
            </Flex>
        </Layer>
    );
}

/**
 * Таблица на фоне поверхности. Ячейки таблицы рисуют свой фон, поэтому фон поверхности передаётся
 * и в токены таблицы, а заголовок и наведение берут более тёмный фон той же поверхности.
 */
function ZoneTable({ children }: { readonly children: ReactNode }) {
    const layer = useLayer();
    return (
        <ConfigProvider theme={{ components: { Table: { colorBgContainer: layer.background, headerBg: layer.backgroundStrong, footerBg: layer.backgroundStrong, rowHoverBg: layer.backgroundStrong } } }}>
            {children}
        </ConfigProvider>
    );
}

/**
 * Товары продаж: строка на товар. Суммы оплат — доли оплат продажи, приходящиеся на товар:
 * продажа хранит оплаты целиком, а отметку «Проведено в 1С» — у каждого товара. Итоговая строка
 * показывает, сколько получено наличными и безналичными и сколько выдано в рассрочку. Под суммой
 * в рассрочку стоит внесённая по ней часть, под общим итогом — итог с внесённой частью вместо
 * полной суммы в рассрочку.
 */
function GoodsTable({ block }: { readonly block: SummaryGoodsBlock }) {
    return (
        <Table
            size="small"
            pagination={false}
            rowKey={(row) => `${row.sale}-${block.rows.indexOf(row)}`}
            dataSource={[...block.rows]}
            columns={[
                { title: 'Дата', key: 'date', render: (_value, row) => <Moment value={row.date} /> },
                { title: 'Продажа', key: 'sale', render: (_value, row) => <Reference kind="document" name="sale" guid={row.sale} /> },
                // Реквизиты товара начинаются с кода и названия, как в формах документов.
                { title: 'Код', dataIndex: 'code', key: 'code' },
                { title: 'Товар', dataIndex: 'name', key: 'name' },
                { title: 'Размер', dataIndex: 'size', key: 'size' },
                ...paymentColumns<SummaryGoodsBlock['rows'][number]>(),
                { title: 'Итог', key: 'total', align: 'right', render: (_value, row) => <Money value={row.total} /> },
            ]}
            summary={() => (
                <Table.Summary.Row>
                    <SummaryCell index={0}>Итого</SummaryCell>
                    <SummaryCell index={1} />
                    <SummaryCell index={2} />
                    <SummaryCell index={3} />
                    <SummaryCell index={4} />
                    <SummaryCell index={5} align="right"><Money value={block.totals.cash} /></SummaryCell>
                    <SummaryCell index={6} align="right"><Money value={block.totals.cashless} /></SummaryCell>
                    <SummaryCell index={7} align="right"><InstallmentTotal total={block.totals.installment} paid={block.installmentPaid} /></SummaryCell>
                    <SummaryCell index={8} align="right"><GrandTotal total={block.total} totals={block.totals} paid={block.installmentPaid} /></SummaryCell>
                </Table.Summary.Row>
            )}
        />
    );
}

/** Строка совокупных итогов продаж. */
interface AllSalesRow {
    readonly count: number;
    readonly payments: PaymentTotals;
    readonly total: number;
    readonly installmentPaid: number;
}

/**
 * Совокупные итоги продаж одной строкой: проведённые и не проведённые в 1С товары вместе.
 * Колонки сумм те же, что в итоговых строках зон, поэтому суммы читаются как их сложение.
 */
function AllSalesTable({ totals }: { readonly totals: PeriodSummary['allSales'] }) {
    const row: AllSalesRow = { count: totals.count, payments: totals.totals, total: totals.total, installmentPaid: totals.installmentPaid };
    return (
        <Table<AllSalesRow>
            size="small"
            pagination={false}
            rowKey={() => 'all'}
            dataSource={[row]}
            columns={[
                { title: 'Товаров', key: 'count', render: (_value, line) => line.count },
                ...paymentColumns<AllSalesRow>().map((column) => column.key === 'installment'
                    ? { ...column, render: (_value: unknown, line: AllSalesRow) => <InstallmentTotal total={line.payments.installment} paid={line.installmentPaid} /> }
                    : column),
                { title: 'Итог', key: 'total', align: 'right', render: (_value, line) => <Typography.Text strong><GrandTotal total={line.total} totals={line.payments} paid={line.installmentPaid} /></Typography.Text> },
            ]}
        />
    );
}

/**
 * Отчёт за период: продажи, взносы и должники, товары в отвесе. Продажи — одна группа из трёх зон:
 * проведённое в 1С залито цветом предупреждения, непроведённое — серым фоном вложенной поверхности,
 * чтобы их нельзя было спутать. Под ними зона «Всего» цвета итога складывает обе. Взносы
 * и должники — одна группа о рассрочках, их таблицы разделены линией.
 */
function Summary({ summary }: { readonly summary: PeriodSummary }) {
    const { payments, weighings, debtors } = summary;
    return (
        <Flex vertical gap="middle">
            <Panel title="Продажи">
                <Flex vertical gap="middle">
                    <FilledZone title="Проведено в 1С" tone="warning" empty={summary.postedIn1C.rows.length === 0}>
                        <GoodsTable block={summary.postedIn1C} />
                    </FilledZone>
                    <FilledZone title="Не проведено в 1С" empty={summary.notPostedIn1C.rows.length === 0}>
                        <GoodsTable block={summary.notPostedIn1C} />
                    </FilledZone>
                    <FilledZone title="Всего" tone="total" empty={summary.allSales.count === 0}>
                        <AllSalesTable totals={summary.allSales} />
                    </FilledZone>
                </Flex>
            </Panel>
            <Panel title="Рассрочки">
                <Typography.Text strong>Взносы</Typography.Text>
                {payments.rows.length === 0 ? <div><Typography.Text type="secondary">Строк нет</Typography.Text></div> : (
                    <Table
                        size="small"
                        pagination={false}
                        rowKey={(row) => `${row.installment}-${row.date}-${row.amount}`}
                        dataSource={[...payments.rows]}
                        columns={[
                            { title: 'Дата', key: 'date', render: (_value, row) => <Moment value={row.date} /> },
                            { title: 'Рассрочка', key: 'installment', render: (_value, row) => <Reference kind="document" name="saleInstallment" guid={row.installment} /> },
                            { title: 'Покупатель', key: 'person', render: (_value, row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                            { title: 'Способ', dataIndex: 'method', key: 'method' },
                            { title: 'Сумма', key: 'amount', align: 'right', render: (_value, row) => <Money value={row.amount} /> },
                        ]}
                        summary={() => (
                            <Table.Summary.Row>
                                <SummaryCell index={0}>Итого</SummaryCell>
                                <SummaryCell index={1} />
                                <SummaryCell index={2} />
                                <SummaryCell index={3}>Наличные <Money value={payments.totals.cash} />, безналичные <Money value={payments.totals.cashless} /></SummaryCell>
                                <SummaryCell index={4} align="right"><Money value={payments.totals.cash + payments.totals.cashless} /></SummaryCell>
                            </Table.Summary.Row>
                        )}
                    />
                )}
                <Divider style={{ marginBlock: spacing[5] }} />
                <Typography.Text strong>Должники</Typography.Text>
                {debtors.rows.length === 0 ? <div><Typography.Text type="secondary">Строк нет</Typography.Text></div> : (
                    <Table
                        size="small"
                        pagination={false}
                        rowKey="person"
                        dataSource={[...debtors.rows]}
                        expandable={{
                            expandRowByClick: true,
                            expandedRowRender: (debtor) => (
                                <Table
                                    size="small"
                                    pagination={false}
                                    rowKey="installment"
                                    dataSource={[...debtor.installments]}
                                    columns={[
                                        { title: 'Дата', key: 'date', render: (_value, row) => <Moment value={row.date} /> },
                                        { title: 'Продажа', key: 'sale', render: (_value, row) => <Reference kind="document" name="sale" guid={row.sale} /> },
                                        { title: 'Рассрочка', key: 'installment', render: (_value, row) => <Reference kind="document" name="saleInstallment" guid={row.installment} /> },
                                        { title: 'Сумма рассрочки', key: 'amount', align: 'right', render: (_value, row) => <Money value={row.amount} /> },
                                        { title: 'Непогашенная часть долга', key: 'debt', align: 'right', render: (_value, row) => <Debt value={row.debt} /> },
                                    ]}
                                />
                            ),
                        }}
                        columns={[
                            { title: 'Покупатель', key: 'person', render: (_value, row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                            { title: 'Рассрочек', key: 'count', align: 'right', render: (_value, row) => row.installments.length },
                            { title: 'Непогашенная часть долга', key: 'debt', align: 'right', render: (_value, row) => <Debt value={row.debt} /> },
                        ]}
                        summary={() => (
                            <Table.Summary.Row>
                                {/* Первая ячейка стоит под колонкой кнопок раскрытия. */}
                                <SummaryCell index={0} />
                                <SummaryCell index={1}>Итого</SummaryCell>
                                <SummaryCell index={2} />
                                <SummaryCell index={3} align="right"><Text tone="debt" strong><Money value={debtors.total} /></Text></SummaryCell>
                            </Table.Summary.Row>
                        )}
                    />
                )}
            </Panel>
            <Block title="Товары в отвесе" empty={weighings.rows.length === 0}>
                <Table
                    size="small"
                    pagination={false}
                    rowKey={(row) => `${row.weighing}-${weighings.rows.indexOf(row)}`}
                    dataSource={[...weighings.rows]}
                    columns={[
                        { title: 'Дата', key: 'date', render: (_value, row) => <Moment value={row.date} /> },
                        { title: 'Отвес', key: 'weighing', render: (_value, row) => <Reference kind="document" name="weighing" guid={row.weighing} /> },
                        { title: 'Покупатель', key: 'person', render: (_value, row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                        // У отложенных товаров тот же порядок реквизитов, что у проданных.
                        { title: 'Код', dataIndex: 'code', key: 'code' },
                        { title: 'Товар', dataIndex: 'name', key: 'name' },
                        { title: 'Размер', dataIndex: 'size', key: 'size' },
                    ]}
                />
            </Block>
        </Flex>
    );
}

/**
 * Страница «Сводка за период». Период задаётся днями включительно. По умолчанию он начинается
 * с первого дня незакрытого периода, то есть со дня после последнего проведённого закрытия,
 * и заканчивается сегодня; без закрытий отчёт строится за сегодня. Кнопки после дат ставят
 * незакрытый период и сегодняшний день. Начало незакрытого периода подставляется, только пока
 * пользователь не выбрал дату сам: иначе ответ сервера перезаписал бы его выбор.
 * Отчёт строит сервер действием «Сводка за период»: оно читает данные в одной транзакции,
 * и суммы блоков согласованы между собой. Должники считаются на конец периода: долг рассрочки
 * уменьшают только взносы, внесённые по последний день периода.
 */
export default function PeriodSummaryPage() {
    const [from, setFrom] = useState<string>(today);
    const [to, setTo] = useState<string>(today);
    const [chosen, setChosen] = useState(false);
    const closings = useRecordList(Objects.document.periodClosing, {
        permanentFilter: [{ field: 'posted', operator: 'equals', value: true }, { field: 'deletedAt', operator: 'equals', value: null }],
        sort: [{ field: 'closedThrough', direction: 'descending' }],
        pageSize: 1,
    });
    const closedThrough = closings.records[0]?.closedThrough ?? null;
    const unclosedStart = closedThrough === null ? null : nextDay(closedThrough);
    useEffect(() => {
        if (!chosen && unclosedStart !== null) setFrom(unclosedStart);
    }, [chosen, unclosedStart]);
    const report = useActionResult<PeriodSummary>({ object: Objects.document.periodClosing, action: 'periodSummary', payload: { periodStart: from, periodEnd: to }, enabled: from <= to });
    return (
        <Page title="Сводка за период">
            <Flex vertical gap="middle">
                <Panel>
                    {/* Поля периода стоят в колонках сетки, как поля форм, кнопки выбора — в оставшихся колонках строки. */}
                    <Grid gutter="narrow">
                        <Column span={{ md: 4 }}>
                            <FluidField label="С" required>
                                {/* Пустое значение не принимается: отчёт всегда строится за какие-то дни. */}
                                <FieldInput field={dayField} value={from} onChange={(value) => { if (typeof value === 'string') { setChosen(true); setFrom(value); } }} />
                            </FluidField>
                        </Column>
                        <Column span={{ md: 4 }}>
                            <FluidField label="По" required>
                                <FieldInput field={dayField} value={to} onChange={(value) => { if (typeof value === 'string') { setChosen(true); setTo(value); } }} />
                            </FluidField>
                        </Column>
                        <Column span={{ md: 8 }}>
                            <Stack orientation="horizontal" gap={3} wrap>
                                {/* Без проведённых закрытий незакрытый период начинается с начала учёта: дня для кнопки нет. */}
                                <Button disabled={unclosedStart === null} onClick={() => { setChosen(true); if (unclosedStart !== null) setFrom(unclosedStart); setTo(today()); }}>С незакрытого периода</Button>
                                <Button onClick={() => { setChosen(true); setFrom(today()); setTo(today()); }}>За сегодня</Button>
                            </Stack>
                        </Column>
                    </Grid>
                </Panel>
                {from > to ? (
                    <Alert type="warning" showIcon title="Начало периода позже его конца" />
                ) : report.data === undefined ? (
                    report.loading
                        ? <Typography.Text type="secondary">Загрузка…</Typography.Text>
                        : <Alert type="error" showIcon title="Не удалось построить отчёт" description="Нет права на отчёт, или сервер отклонил запрос" />
                ) : <Summary summary={report.data} />}
            </Flex>
        </Page>
    );
}
