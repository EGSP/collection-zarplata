import { CertificatesTable, Money, OperationsTable, summaryScroll, SummaryTotalsPanel } from './period-summary-tables';
import { DataTable, StickyRail } from '../../web/sdk';
import { Alert, Button } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Column, FieldDisplay, FieldInput, FluidField, isEmptyFieldValue, Grid, Layer, Page, Panel, RecordLink, Stack, Text, useActionResult, useRecordList, type AccountingTone } from '../../web/sdk';
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
            {empty ? <Text tone="secondary">Строк нет</Text> : children}
        </Panel>
    );
}

/** Способ взноса наличными: остальные взносы безналичные. Значение совпадает с перечнем способов оплаты. */
const cashMethod = 'Наличные';

/** Непогашенная часть долга должника: цвета долга, как незакрытая рассрочка выше. */
function Debt({ value }: { readonly value: number }) {
    return <Text tone="debt"><Money value={value} /></Text>;
}

/**
 * Зона продаж с заливкой: подзаголовок и таблица на одной поверхности. Без `tone` зона берёт фон
 * следующего уровня и отличается от панели серым; со смысловым цветом залита им.
 */
function FilledZone({ title, tone, children }: { readonly title: string; readonly tone?: AccountingTone; readonly children: ReactNode }) {
    return (
        <Layer padding={4} {...(tone === undefined ? {} : { tone })}>
            <Stack gap={3}>
                <Text strong>{title}</Text>
                {children}
            </Stack>
        </Layer>
    );
}


/**
 * Отчёт за период: продажи, взносы и должники, товары в отвесе. Продажи и возвраты сгруппированы в две зоны:
 * проведённое в 1С залито цветом предупреждения, непроведённое — серым фоном вложенной поверхности,
 * чтобы их нельзя было спутать. Итоги обеих зон стоят на рельсе справа, на узкой области под ними. Взносы
 * и должники — одна группа о рассрочках. Сертификаты стоят отдельной панелью со своим итогом:
 * их деньги во «Всего» не входят и на рельсе показаны отдельной строкой.
 */
function Summary({ summary }: { readonly summary: PeriodSummary }) {
    const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
    const { payments, weighings, debtors, certificates } = summary;
    return (
        <Stack gap={5}>
            <Grid>
                <Column span={{ lg: 12 }}>
                    <Panel title="Продажи и возвраты">
                        <Stack gap={5}>
                            <FilledZone title="Проведено в 1С" tone="warning">
                                <OperationsTable rows={summary.operations.posted.rows} totals={summary.operations.posted.totals} />
                            </FilledZone>
                            <FilledZone title="Не проведено в 1С">
                                <OperationsTable rows={summary.operations.notPosted.rows} totals={summary.operations.notPosted.totals} />
                            </FilledZone>
                        </Stack>
                    </Panel>
                </Column>
                <Column span={{ lg: 4 }}>
                    <StickyRail from="lg"><SummaryTotalsPanel amounts={summary.totals} certificates={certificates.totals} /></StickyRail>
                </Column>
            </Grid>
            <Panel title="Сертификаты">
                <CertificatesTable rows={certificates.rows} totals={certificates.totals} />
            </Panel>
            <Panel title="Рассрочки">
                <Stack gap={5}>
                    <Stack gap={3}>
                        <Text strong>Взносы</Text>
                        {payments.rows.length === 0 ? <Text tone="secondary">Строк нет</Text> : (
                            <DataTable
                                {...summaryScroll}
                                rowKey={(row, index) => `${row.installment}-${row.date}-${index}`}
                                rows={[...payments.rows]}
                                // Взнос занимает одну строку на любой ширине: колонок немного, и все суммы видны сразу.
                                layouts={{ sm: [{ line: [{ group: ['date', 'person'] }, 'installment', { group: ['cash', 'cashless'] }] }], lg: [] }}
                                columns={[
                                    { title: 'Дата', key: 'date', type: 'dateTime' as const, render: (row) => <Moment value={row.date} /> },
                                    { title: 'Покупатель', key: 'person', type: 'free' as const, size: { minimum: 20, weight: 1 }, render: (row) => <Reference kind="catalog" name="physicalPersons" guid={row.person} /> },
                                    { title: 'Рассрочка', key: 'installment', type: 'free' as const, size: { minimum: 20, weight: 1 }, render: (row) => <Reference kind="document" name="saleInstallment" guid={row.installment} /> },
                                    // Взнос принят одним способом, поэтому его сумма стоит в одной из двух колонок.
                                    { title: 'Наличные', key: 'cash', type: 'money' as const, value: (row) => row.method === cashMethod ? row.amount : null },
                                    { title: 'Безналичные', key: 'cashless', type: 'money' as const, value: (row) => row.method === cashMethod ? null : row.amount },
                                ]}
                                summary={{ date: 'Итого', cash: payments.totals.cash, cashless: payments.totals.cashless }}
                            />
                        )}
                    </Stack>
                    <Stack gap={3}>
                        <Text strong>Должники</Text>
                        {debtors.rows.length === 0 ? <Text tone="secondary">Строк нет</Text> : (
                            <DataTable
                                {...summaryScroll}
                                rowKey={(row) => row.person}
                                rows={[...debtors.rows]}
                                layouts={{ sm: [{ line: [{ group: ['person', 'count'] }, 'debt'] }], lg: [] }}
                                expansion={{
                                    isExpandable: () => true,
                                    isExpanded: (row) => expanded.has(row.person),
                                    onToggle: (row, _index, open) => setExpanded((previous) => { const next = new Set(previous); if (open) next.add(row.person); else next.delete(row.person); return next; }),
                                    render: (debtor) => (
                                        <DataTable
                                            rowKey={(row) => row.installment}
                                            rows={[...debtor.installments]}
                                            layouts={{ sm: [{ line: [{ group: ['installment', 'date'] }, { group: ['sale', 'amount'] }, 'debt'] }], lg: [{ line: [{ group: ['installment', 'date'] }, { group: ['sale', 'amount'] }, 'debt'] }] }}
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
                    </Stack>
                </Stack>
            </Panel>
            <Block title="Товары в отвесе" empty={weighings.rows.length === 0}>
                <DataTable
                    {...summaryScroll}
                    rowKey={(row) => `${row.weighing}-${weighings.rows.indexOf(row)}`}
                    rows={[...weighings.rows]}
                    layouts={{ sm: [{ line: [{ group: ['code', 'name', 'size'] }, { group: ['person', 'date', 'weighing'] }] }], lg: [{ line: [{ group: ['name', 'code', 'size'] }, { group: ['person', 'date', 'weighing'] }] }] }}
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
        </Stack>
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
            <Stack gap={5}>
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
                        ? <Text tone="secondary">Загрузка…</Text>
                        : <Alert type="error" showIcon title="Не удалось построить отчёт" description="Нет права на отчёт, или сервер отклонил запрос" />
                ) : <Summary summary={report.data} />}
            </Stack>
        </Page>
    );
}
