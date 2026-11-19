import { CertificatesTable, Money, OperationsTable, summaryLayout, SummaryTotalsPanel, type SummaryVariant } from './period-summary-tables';
import { DataTable, Icons, StickyRail } from '../../web/sdk';
import { Alert, Button, Tabs } from 'antd';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Column, FieldDisplay, FieldInput, FluidField, isEmptyFieldValue, Grid, Layer, Page, Panel, RecordLink, Stack, Text, useActionResult, useRecordList, type AccountingTone } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { PeriodSummary } from '../period-summary';
import type { CashSummary } from '../cash-summary';

/** Сегодняшний день датой `ГГГГ-ММ-ДД` по часам браузера: отчёт по умолчанию строится за него. */
function today(): string {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** День, сдвинутый на `days` дней. Считается в UTC, как на сервере, чтобы переход на летнее время не сдвигал день. */
function shiftDay(day: string, days: number): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** Следующий день даты `ГГГГ-ММ-ДД`. */
const nextDay = (day: string): string => shiftDay(day, 1);

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
 * Продажи и возвраты двух зон 1С с итогом «Всего» на рельсе справа; на узкой области итог стоит
 * под зонами. Обе вкладки показывают зоны одинаково и различаются правилами сумм (`variant`)
 * и тем, что касса не показывает сертификаты.
 */
function Zones({ operations, totals, certificates, variant }: {
    readonly operations: PeriodSummary['operations'];
    readonly totals: PeriodSummary['totals'];
    readonly certificates?: PeriodSummary['certificates']['totals'] | undefined;
    readonly variant: SummaryVariant;
}) {
    return (
        <Grid>
            <Column span={{ lg: 12 }}>
                <Panel title="Продажи и возвраты">
                    <Stack gap={5}>
                        <FilledZone title="Проведено в 1С" tone="warning">
                            <OperationsTable rows={operations.posted.rows} totals={operations.posted.totals} variant={variant} />
                        </FilledZone>
                        <FilledZone title="Не проведено в 1С">
                            <OperationsTable rows={operations.notPosted.rows} totals={operations.notPosted.totals} variant={variant} />
                        </FilledZone>
                    </Stack>
                </Panel>
            </Column>
            <Column span={{ lg: 4 }}>
                <StickyRail from="lg"><SummaryTotalsPanel totals={totals} certificates={certificates} variant={variant} /></StickyRail>
            </Column>
        </Grid>
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
            <Zones operations={summary.operations} totals={summary.totals} certificates={certificates.totals} variant="period" />
            <Panel title="Сертификаты">
                <CertificatesTable rows={certificates.rows} totals={certificates.totals} />
            </Panel>
            <Panel title="Рассрочки">
                <Stack gap={5}>
                    <Stack gap={3}>
                        <Text strong>Взносы</Text>
                        {payments.rows.length === 0 ? <Text tone="secondary">Строк нет</Text> : (
                            <DataTable
                                rowKey={(row, index) => `${row.installment}-${row.date}-${index}`}
                                rows={[...payments.rows]}
                                // Взнос занимает одну строку на любой ширине: колонок немного, и все суммы видны сразу.
                                layouts={{ sm: { lines: [{ line: [{ group: ['date', 'person'] }, 'installment', { group: ['cash', 'cashless'] }] }] }, md: summaryLayout, lg: { lines: [] } }}
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
                                rowKey={(row) => row.person}
                                rows={[...debtors.rows]}
                                layouts={{ sm: { lines: [{ line: [{ group: ['person', 'count'] }, 'debt'] }] }, md: summaryLayout, lg: { lines: [] } }}
                                expansion={{
                                    isExpandable: () => true,
                                    isExpanded: (row) => expanded.has(row.person),
                                    onToggle: (row, _index, open) => setExpanded((previous) => { const next = new Set(previous); if (open) next.add(row.person); else next.delete(row.person); return next; }),
                                    render: (debtor) => (
                                        <DataTable
                                            rowKey={(row) => row.installment}
                                            rows={[...debtor.installments]}
                                            layouts={{ sm: { lines: [{ line: [{ group: ['installment', 'date'] }, { group: ['sale', 'amount'] }, 'debt'] }] }, lg: { lines: [{ line: [{ group: ['installment', 'date'] }, { group: ['sale', 'amount'] }, 'debt'] }] } }}
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
                    rowKey={(row) => `${row.weighing}-${weighings.rows.indexOf(row)}`}
                    rows={[...weighings.rows]}
                    layouts={{ sm: { lines: [{ line: [{ group: ['code', 'name', 'size'] }, { group: ['person', 'date', 'weighing'] }] }] }, md: summaryLayout, lg: { lines: [{ line: [{ group: ['name', 'code', 'size'] }, { group: ['person', 'date', 'weighing'] }] }] } }}
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
 * Вкладка «Период»: сводка за период. Период задаётся днями включительно. По умолчанию он начинается
 * с первого дня незакрытого периода, то есть со дня после последнего проведённого закрытия,
 * и заканчивается сегодня; без закрытий отчёт строится за сегодня. Кнопки после дат ставят
 * незакрытый период и сегодняшний день. Начало незакрытого периода подставляется, только пока
 * пользователь не выбрал дату сам: иначе ответ сервера перезаписал бы его выбор.
 * Отчёт строит сервер действием «Сводка за период»: оно читает данные в одной транзакции,
 * и суммы блоков согласованы между собой. Должники считаются на конец периода: долг рассрочки
 * уменьшают только взносы, внесённые по последний день периода.
 */
function PeriodTab() {
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
    );
}

/** Ответ на запрос отчёта: загрузка, ошибка или готовые данные. */
function ReportState<Data>({ report, children }: { readonly report: { readonly data: Data | undefined; readonly loading: boolean }; readonly children: (data: Data) => ReactNode }) {
    if (report.data !== undefined) return <>{children(report.data)}</>;
    return report.loading
        ? <Text tone="secondary">Загрузка…</Text>
        : <Alert type="error" showIcon title="Не удалось построить отчёт" description="Нет права на отчёт, или сервер отклонил запрос" />;
}

/**
 * Вкладка «Касса»: кассовая сводка за один день для сверки с кассовым чеком закрытия дня.
 * Правила сумм отличаются от сводки за период раскладкой рассрочки (раздел «Правила учёта»,
 * «Кассовая сводка»), поэтому «Итого» кассы может не совпадать с вкладкой «Период» за тот же день.
 *
 * День по умолчанию сегодняшний. Стрелки переходят на соседний день; будущих дней касса
 * не показывает, поэтому стрелка вперёд на сегодняшнем дне недоступна, а выбранный в поле
 * будущий день заменяется сегодняшним.
 */
function CashTab() {
    const [day, setDay] = useState<string>(today);
    const current = today();
    const report = useActionResult<CashSummary>({ object: Objects.document.periodClosing, action: 'cashSummary', payload: { summaryDay: day } });
    return (
        <Stack gap={5}>
            <Panel>
                <Grid gutter="narrow">
                    <Column span={{ md: 4 }}>
                        <FluidField label="День" required empty={isEmptyFieldValue(day)}>
                            {/* Пустое значение не принимается: касса всегда показывает какой-то день. */}
                            <FieldInput field={dayField} value={day} onChange={(value) => { if (typeof value === 'string') setDay(value > current ? current : value); }} />
                        </FluidField>
                    </Column>
                    <Column span={{ md: 4 }}>
                        <Stack orientation="horizontal" gap={3}>
                            <Button aria-label="Предыдущий день" icon={<Icons.previousDay />} onClick={() => setDay(shiftDay(day, -1))} />
                            <Button aria-label="Следующий день" icon={<Icons.nextDay />} disabled={day >= current} onClick={() => setDay(shiftDay(day, 1))} />
                            <Button disabled={day === current} onClick={() => setDay(today())}>Сегодня</Button>
                        </Stack>
                    </Column>
                </Grid>
            </Panel>
            <ReportState report={report}>
                {(summary) => <Zones operations={summary.operations} totals={summary.totals} variant="cash" />}
            </ReportState>
        </Stack>
    );
}

/**
 * Подпись вкладки с иконкой по правилам Carbon Tabs: иконка 16 px стоит справа от подписи
 * через 8 px. Иконки есть у всех вкладок страницы: Carbon не смешивает вкладки с иконкой и без.
 */
function TabTitle({ title, icon }: { readonly title: string; readonly icon: ReactNode }) {
    return <Stack orientation="horizontal" gap={3} align="center">{title}{icon}</Stack>;
}

/**
 * Страница «Сводка» из двух вкладок. «Касса» открыта по умолчанию: продавцы чаще всего
 * сверяют день с кассовым чеком. «Период» — сводка за период со всеми таблицами. Вкладки
 * не размонтируются при переключении, поэтому выбранные день и период сохраняются.
 */
export default function PeriodSummaryPage() {
    const [tab, setTab] = useState('cash');
    return (
        <Page title="Сводка">
            <Tabs activeKey={tab} onChange={setTab} items={[
                { key: 'cash', label: <TabTitle title="Касса" icon={<Icons.cashSummary />} />, children: <CashTab /> },
                { key: 'period', label: <TabTitle title="Период" icon={<Icons.periodSummary />} />, children: <PeriodTab /> },
            ]} />
        </Page>
    );
}
