import { Alert, Card, ConfigProvider, Divider, Flex, Table, theme, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { FieldDisplay, FieldInput, FluidField, Page, RecordLink, useActionResult } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { PaymentTotals, PeriodSummary, SummaryGoodsBlock } from '../period-summary';

/** Сегодняшний день датой `ГГГГ-ММ-ДД` по часам браузера: отчёт по умолчанию строится за него. */
function today(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
        <Card size="small" title={title}>
            {empty ? <Typography.Text type="secondary">Строк нет</Typography.Text> : children}
        </Card>
    );
}

/** Колонки сумм по способам оплаты. */
const paymentColumns = <Row extends { readonly payments: PaymentTotals }>() => [
    { title: 'Наличные', key: 'cash', align: 'right' as const, render: (_value: unknown, row: Row) => <Money value={row.payments.cash} /> },
    { title: 'Безналичные', key: 'cashless', align: 'right' as const, render: (_value: unknown, row: Row) => <Money value={row.payments.cashless} /> },
    { title: 'Рассрочка', key: 'installment', align: 'right' as const, render: (_value: unknown, row: Row) => <Money value={row.payments.installment} /> },
];

/** Заливка зоны таблицы: фон строк, фон заголовка и наведения. */
interface Fill {
    readonly body: string;
    readonly header: string;
}

/**
 * Зона продаж с заливкой: подзаголовок и таблица на одном фоне. Ячейки таблицы рисуют свой фон,
 * поэтому заливка передаётся и в токены таблицы через `ConfigProvider`, а не только в обёртку.
 * Цвета взяты из светлых оттенков палитры Ant Design: основной текст на них читается с прежним
 * контрастом, а заголовок таблицы чуть темнее строк.
 */
function FilledZone({ title, fill, empty, children }: { readonly title: string; readonly fill: Fill; readonly empty: boolean; readonly children: ReactNode }) {
    const { token } = theme.useToken();
    return (
        <div style={{ background: fill.body, borderRadius: token.borderRadiusLG, padding: token.paddingSM }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: token.marginXS }}>{title}</Typography.Text>
            {empty ? <Typography.Text type="secondary">Строк нет</Typography.Text> : (
                <ConfigProvider theme={{ components: { Table: { colorBgContainer: fill.body, headerBg: fill.header, footerBg: fill.header, rowHoverBg: fill.header } } }}>
                    {children}
                </ConfigProvider>
            )}
        </div>
    );
}

/**
 * Товары продаж: строка на товар. Суммы оплат — доли оплат продажи, приходящиеся на товар:
 * продажа хранит оплаты целиком, а отметку «Проведено в 1С» — у каждого товара. Итоговая строка
 * показывает, сколько получено наличными и безналичными и сколько выдано в рассрочку.
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
                { title: 'Товар', dataIndex: 'name', key: 'name' },
                { title: 'Код', dataIndex: 'code', key: 'code' },
                ...paymentColumns<SummaryGoodsBlock['rows'][number]>(),
                { title: 'Итог', key: 'total', align: 'right', render: (_value, row) => <Money value={row.total} /> },
            ]}
            summary={() => (
                <Table.Summary.Row>
                    <SummaryCell index={0}>Итого</SummaryCell>
                    <SummaryCell index={1} />
                    <SummaryCell index={2} />
                    <SummaryCell index={3} />
                    <SummaryCell index={4} align="right"><Money value={block.totals.cash} /></SummaryCell>
                    <SummaryCell index={5} align="right"><Money value={block.totals.cashless} /></SummaryCell>
                    <SummaryCell index={6} align="right"><Money value={block.totals.installment} /></SummaryCell>
                    <SummaryCell index={7} align="right"><Money value={block.total} /></SummaryCell>
                </Table.Summary.Row>
            )}
        />
    );
}

/**
 * Отчёт за период: продажи, товары в отвесе, взносы и должники. Продажи — одна группа из двух зон:
 * проведённое в 1С залито жёлтым, непроведённое — серым, чтобы их нельзя было спутать. Взносы
 * и должники — одна группа о рассрочках, их таблицы разделены линией.
 */
function Summary({ summary }: { readonly summary: PeriodSummary }) {
    const { token } = theme.useToken();
    const { payments, weighings, debtors } = summary;
    return (
        <Flex vertical gap="middle">
            <Card size="small" title="Продажи">
                <Flex vertical gap="middle">
                    <FilledZone title="Проведено в 1С" fill={{ body: token.colorWarningBg, header: token.colorWarningBgHover }} empty={summary.postedIn1C.rows.length === 0}>
                        <GoodsTable block={summary.postedIn1C} />
                    </FilledZone>
                    <FilledZone title="Не проведено в 1С" fill={{ body: token.colorFillQuaternary, header: token.colorFillTertiary }} empty={summary.notPostedIn1C.rows.length === 0}>
                        <GoodsTable block={summary.notPostedIn1C} />
                    </FilledZone>
                </Flex>
            </Card>
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
                        { title: 'Товар', dataIndex: 'name', key: 'name' },
                        { title: 'Код', dataIndex: 'code', key: 'code' },
                        { title: 'Итог', key: 'total', align: 'right', render: (_value, row) => <Money value={row.total} /> },
                    ]}
                    summary={() => (
                        <Table.Summary.Row>
                            <SummaryCell index={0}>Итого</SummaryCell>
                            <SummaryCell index={1} />
                            <SummaryCell index={2} />
                            <SummaryCell index={3} />
                            <SummaryCell index={4} />
                            <SummaryCell index={5} align="right"><Money value={weighings.total} /></SummaryCell>
                        </Table.Summary.Row>
                    )}
                />
            </Block>
            <Card size="small" title="Рассрочки">
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
                <Divider style={{ marginBlock: token.margin }} />
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
                                        { title: 'Долг', key: 'debt', align: 'right', render: (_value, row) => <Money value={row.debt} /> },
                                    ]}
                                />
                            ),
                        }}
                        columns={[
                            { title: 'Покупатель', key: 'person', render: (_value, row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                            { title: 'Рассрочек', key: 'count', align: 'right', render: (_value, row) => row.installments.length },
                            { title: 'Долг', key: 'debt', align: 'right', render: (_value, row) => <Money value={row.debt} /> },
                        ]}
                        summary={() => (
                            <Table.Summary.Row>
                                {/* Первая ячейка стоит под колонкой кнопок раскрытия. */}
                                <SummaryCell index={0} />
                                <SummaryCell index={1}>Итого</SummaryCell>
                                <SummaryCell index={2} />
                                <SummaryCell index={3} align="right"><Money value={debtors.total} /></SummaryCell>
                            </Table.Summary.Row>
                        )}
                    />
                )}
            </Card>
        </Flex>
    );
}

/**
 * Страница «Сводка за период». Период задаётся днями включительно, по умолчанию сегодняшним днём.
 * Отчёт строит сервер действием «Сводка за период»: оно читает данные в одной транзакции,
 * и суммы блоков согласованы между собой. Должники считаются на конец периода: долг рассрочки
 * уменьшают только взносы, внесённые по последний день периода.
 */
export default function PeriodSummaryPage() {
    const [from, setFrom] = useState<string>(today);
    const [to, setTo] = useState<string>(today);
    const report = useActionResult<PeriodSummary>({ object: Objects.document.periodClosing, action: 'periodSummary', payload: { periodStart: from, periodEnd: to }, enabled: from <= to });
    return (
        <Page title="Сводка за период">
            <Flex vertical gap="middle">
                <Card size="small">
                    <Flex gap="middle" wrap>
                        <div style={{ width: 200 }}>
                            <FluidField label="С" required>
                                {/* Пустое значение не принимается: отчёт всегда строится за какие-то дни. */}
                                <FieldInput field={dayField} value={from} onChange={(value) => { if (typeof value === 'string') setFrom(value); }} />
                            </FluidField>
                        </div>
                        <div style={{ width: 200 }}>
                            <FluidField label="По" required>
                                <FieldInput field={dayField} value={to} onChange={(value) => { if (typeof value === 'string') setTo(value); }} />
                            </FluidField>
                        </div>
                    </Flex>
                </Card>
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
