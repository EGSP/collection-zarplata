import { PeriodSummaryFeed, SummaryTotalsPanel } from './period-summary-feed';
import { StickyRail } from '../../web/sdk';
import { DataTable } from '../../web/sdk';
import { Alert, Button, Divider, Flex, Typography } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Column, FieldDisplay, FieldInput, FluidField, isEmptyFieldValue, Grid, Layer, Page, Panel, RecordLink, spacing, Stack, Text, useActionResult, useRecordList, type AccountingTone } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { PeriodSummary } from '../period-summary';

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


/** Блок отчёта: заголовок и содержимое; пустой блок сообщает, что строк нет. */
function Block({ title, empty, children }: { readonly title: string; readonly empty: boolean; readonly children: ReactNode }) {
    return (
        <Panel title={title}>
            {empty ? <Typography.Text type="secondary">Строк нет</Typography.Text> : children}
        </Panel>
    );
}

/** Непогашенная часть долга должника: цвета долга, как незакрытая рассрочка выше. */
function Debt({ value }: { readonly value: number }) {
    return <Text tone="debt"><Money value={value} /></Text>;
}

/**
 * Зона продаж с заливкой: подзаголовок и таблица на одной поверхности. Без `tone` зона берёт фон
 * следующего уровня и отличается от панели серым; со смысловым цветом залита им.
 */
function FilledZone({ title, tone, empty, children }: { readonly title: string; readonly tone?: AccountingTone; readonly empty: boolean; readonly children: ReactNode }) {
    return (
        <Layer padding={4} {...(tone === undefined ? {} : { tone })}>
            <Flex vertical gap={spacing[3]}>
                <Text strong>{title}</Text>
                {empty ? <Text tone="secondary">Строк нет</Text> : children}
            </Flex>
        </Layer>
    );
}


/**
 * Отчёт за период: продажи, взносы и должники, товары в отвесе. Продажи и возвраты сгруппированы в две зоны:
 * проведённое в 1С залито цветом предупреждения, непроведённое — серым фоном вложенной поверхности,
 * чтобы их нельзя было спутать. Итоги обеих зон стоят на рельсе справа, на узкой области под ними. Взносы
 * и должники — одна группа о рассрочках, их таблицы разделены линией.
 */
function Summary({ summary }: { readonly summary: PeriodSummary }) {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const { payments, weighings, debtors } = summary;
    return (
        <Flex vertical gap="middle">
            <Grid>
                <Column span={{ lg: 12 }}>
                    <Panel title="Продажи и возвраты">
                        <Stack gap={5}>
                            <FilledZone title="Проведено в 1С" tone="warning" empty={false}>
                                <PeriodSummaryFeed title="Проведено в 1С" rows={summary.operations.posted.rows} totals={summary.operations.posted.totals} />
                            </FilledZone>
                            <FilledZone title="Не проведено в 1С" empty={false}>
                                <PeriodSummaryFeed title="Не проведено в 1С" rows={summary.operations.notPosted.rows} totals={summary.operations.notPosted.totals} />
                            </FilledZone>
                        </Stack>
                    </Panel>
                </Column>
                <Column span={{ lg: 4 }}>
                    <StickyRail from="lg"><SummaryTotalsPanel amounts={summary.operations.totals} /></StickyRail>
                </Column>
            </Grid>
            <Panel title="Рассрочки">
                <Typography.Text strong>Взносы</Typography.Text>
                {payments.rows.length === 0 ? <div><Typography.Text type="secondary">Строк нет</Typography.Text></div> : (
                    <DataTable

                        rowKey={(row) => `${row.installment}-${row.date}-${row.amount}`}
                        rows={[...payments.rows]}
                        layouts={{ sm: [['person', 'date'], ['installment', 'method'], 'amount'], lg: [['person', 'date'], ['installment', 'method'], 'amount'] }}
                        columns={[
                            { title: 'Дата', key: 'date', type: 'dateTime' as const, render: (row) => <Moment value={row.date} /> },
                            { title: 'Рассрочка', key: 'installment', type: 'free' as const, render: (row) => <Reference kind="document" name="saleInstallment" guid={row.installment} /> },
                            { title: 'Покупатель', key: 'person', type: 'free' as const, render: (row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                            { title: 'Способ', key: 'method', type: 'string' as const, value: (row) => row.method },
                            { title: 'Сумма', key: 'amount', type: 'money' as const, render: (row) => <Money value={row.amount} /> },
                        ]}
                        summary={{ date: 'Итого', method: <>Наличные <Money value={payments.totals.cash} />, безналичные <Money value={payments.totals.cashless} /></>, amount: <Money value={payments.totals.cash + payments.totals.cashless} /> }}
                    />
                )}
                <Divider style={{ marginBlock: spacing[5] }} />
                <Typography.Text strong>Должники</Typography.Text>
                {debtors.rows.length === 0 ? <div><Typography.Text type="secondary">Строк нет</Typography.Text></div> : (
                    <DataTable

                        rowKey={(row) => row.person}
                        rows={[...debtors.rows]}
                        layouts={{ sm: [['person', 'count'], 'debt'], lg: [] }}
                        expansion={{
                            isExpandable: () => true,
                            isExpanded: (row) => expanded.has(row.person),
                            onToggle: (row, _index, open) => setExpanded((previous) => { const next = new Set(previous); if (open) next.add(row.person); else next.delete(row.person); return next; }),
                            render: (debtor) => (
                                <DataTable

                                    rowKey={(row) => row.installment}
                                    rows={[...debtor.installments]}
                                    layouts={{ sm: [['installment', 'date'], ['sale', 'amount'], 'debt'], lg: [['installment', 'date'], ['sale', 'amount'], 'debt'] }}
                                    columns={[
                                        { title: 'Дата', key: 'date', type: 'dateTime' as const, render: (row) => <Moment value={row.date} /> },
                                        { title: 'Продажа', key: 'sale', type: 'free' as const, render: (row) => <Reference kind="document" name="sale" guid={row.sale} /> },
                                        { title: 'Рассрочка', key: 'installment', type: 'free' as const, render: (row) => <Reference kind="document" name="saleInstallment" guid={row.installment} /> },
                                        { title: 'Сумма рассрочки', key: 'amount', type: 'money' as const, render: (row) => <Money value={row.amount} /> },
                                        { title: 'Долг', key: 'debt', type: 'money' as const, render: (row) => <Debt value={row.debt} /> },
                                    ]}
                                />
                            ),
                        }}
                        columns={[
                            { title: 'Покупатель', key: 'person', type: 'free' as const, render: (row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                            { title: 'Рассрочек', key: 'count', type: 'number' as const, render: (row) => row.installments.length },
                            { title: 'Долг', key: 'debt', type: 'money' as const, render: (row) => <Debt value={row.debt} /> },
                        ]}
                        summary={{ person: 'Итого', debt: <Text tone="debt" strong><Money value={debtors.total} /></Text> }}
                    />
                )}
            </Panel>
            <Block title="Товары в отвесе" empty={weighings.rows.length === 0}>
                <DataTable

                    rowKey={(row) => `${row.weighing}-${weighings.rows.indexOf(row)}`}
                    rows={[...weighings.rows]}
                    layouts={{ sm: [['code', 'name', 'size'], ['person', 'date', 'weighing']], lg: [['name', 'code', 'size'], ['person', 'date', 'weighing']] }}
                    columns={[
                        { title: 'Дата', key: 'date', type: 'dateTime' as const, render: (row) => <Moment value={row.date} /> },
                        { title: 'Отвес', key: 'weighing', type: 'free' as const, render: (row) => <Reference kind="document" name="weighing" guid={row.weighing} /> },
                        { title: 'Покупатель', key: 'person', type: 'free' as const, render: (row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                        // У отложенных товаров тот же порядок реквизитов, что у проданных.
                        { title: 'Код', key: 'code', type: 'string' as const, value: (row) => row.code },
                        { title: 'Товар', key: 'name', type: 'string' as const, value: (row) => row.name },
                        { title: 'Размер', key: 'size', type: 'string' as const, value: (row) => row.size },
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
                            <FluidField label="С" required empty={isEmptyFieldValue(from)}>
                                {/* Пустое значение не принимается: отчёт всегда строится за какие-то дни. */}
                                <FieldInput field={dayField} value={from} onChange={(value) => { if (typeof value === 'string') { setChosen(true); setFrom(value); } }} />
                            </FluidField>
                        </Column>
                        <Column span={{ md: 4 }}>
                            <FluidField label="По" required empty={isEmptyFieldValue(to)}>
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
