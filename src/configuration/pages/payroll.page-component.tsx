import { Alert, Button, Flex, Modal, Table, Tabs, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ActionDialog, Column, FieldDisplay, FieldInput, FluidField, FluidValue, Grid, Layer, Page, pagePath, Panel, RecordLink, Stack, Text, useAction, useActionResult, useObjectView, useOpenRecord, useRecordList, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { PayrollLine, PayrollResult, PayrollRuleDescription } from '../payroll';

/** День, отстоящий от сегодняшнего на `offset` дней, датой `ГГГГ-ММ-ДД` по часам браузера. */
function dayFromToday(offset: number): string {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Поле дня расчёта: дата без времени. */
const dayField = { kind: 'date', target: null } as const;

/** Последний закрытый день перед началом расчёта. UTC сохраняет календарную дату при смене часового пояса. */
function dayBefore(day: string): string {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);
    return date.toISOString().slice(0, 10);
}

/**
 * История действующих закрытий, от новых к старым. Открывается сохранённый документ с итогами
 * и расшифровкой: повторный расчёт по сегодняшним правилам изменил бы смысл прошлой зарплаты.
 * Серверная пагинация не ограничивает историю первыми закрытиями.
 */
function ClosedPeriods() {
    const closings = useRecordList(Objects.document.periodClosing, {
        permanentFilter: [{ field: 'posted', operator: 'equals', value: true }, { field: 'deletedAt', operator: 'equals', value: null }],
        sort: [{ field: 'closedThrough', direction: 'descending' }],
    });
    const openRecord = useOpenRecord();
    if (closings.error !== null) return <Alert type="error" showIcon title="Не удалось загрузить закрытые периоды" />;
    return (
        <Table
            size="small"
            rowKey="guid"
            loading={closings.loading}
            dataSource={[...closings.records]}
            locale={{ emptyText: 'Закрытых периодов нет' }}
            pagination={{ current: closings.page, pageSize: closings.pageSize, total: closings.total, onChange: closings.setPage }}
            columns={[
                // Номер относится к порядку действующих периодов, а не к документу закрытия.
                // При сортировке от новых к старым отсчёт идёт от общего количества, включая другие страницы.
                { title: '№ периода', key: 'periodNumber', width: 110, render: (_value, _row, index) => closings.total - (closings.page - 1) * closings.pageSize - index },
                { title: 'Период', key: 'period', render: (_value, row) => <>{row.periodStart == null ? 'С начала учёта' : <FieldDisplay field={dayField} value={row.periodStart} />} по <FieldDisplay field={dayField} value={row.closedThrough} /></> },
                { title: 'Начислено', key: 'amount', align: 'right', render: (_value, row) => <Money value={row.amount} /> },
                { title: '', key: 'open', render: (_value, row) => <Button type="link" onClick={() => void openRecord(Objects.document.periodClosing, row.guid)}>Открыть</Button> },
            ]}
        />
    );
}

/** Окно правил расчёта: название и описание каждого действующего правила по порядку. */
function RulesDialog({ title, rules, onClose }: { readonly title: string; readonly rules: ReadonlyArray<PayrollRuleDescription>; readonly onClose: () => void }) {
    return (
        <Modal open title={`Правила расчёта: ${title}`} footer={null} width={720} onCancel={onClose}>
            <Flex vertical gap="middle">
                {rules.map((rule) => (
                    <Flex key={rule.name} vertical gap={4}>
                        <Typography.Text strong>{rule.title}</Typography.Text>
                        <Typography.Text>{rule.description}</Typography.Text>
                    </Flex>
                ))}
            </Flex>
        </Modal>
    );
}

/** Представление сотрудника: код из справочника. */
function EmployeeName({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/** Денежная сумма в том же виде, что в формах. */
function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/** Строка начислена рассрочкой или вычтена возвратом по ней: у неё есть дата открытия рассрочки. */
const byInstallment = (line: PayrollLine) => line.installmentDate !== null;

/** Сумма начислений строк. */
const totalOf = (lines: ReadonlyArray<PayrollLine>) => lines.reduce((sum, line) => sum + line.amount, 0);

/** Дата со временем в том же виде, что в формах. */
function Moment({ value }: { readonly value: string | null }) {
    return <FieldDisplay field={{ kind: 'dateTime', target: null }} value={value} />;
}

/**
 * Таблица строк расшифровки. У таблицы рассрочек вместо даты начисления стоят даты открытия
 * и закрытия рассрочки: по ним видно, когда рассрочку оформили и закрыта ли она. Дату возврата
 * по товару из рассрочки показывает ссылка на возврат в колонке «Документ».
 */
function LinesTable({ lines, installments }: { readonly lines: ReadonlyArray<PayrollLine>; readonly installments: boolean }) {
    return (
        <Table
            size="small"
            pagination={false}
            rowKey={(line) => `${line.document.guid}-${line.goods}-${line.kind}-${line.date}-${line.base}-${line.rule}`}
            dataSource={[...lines]}
            columns={[
                ...installments ? [
                    { title: 'Рассрочка открыта', key: 'installmentDate', render: (_value: unknown, line: PayrollLine) => <Moment value={line.installmentDate} /> },
                    { title: 'Рассрочка закрыта', key: 'installmentClosedAt', render: (_value: unknown, line: PayrollLine) => <Moment value={line.installmentClosedAt} /> },
                ] : [{ title: 'Дата', key: 'date', render: (_value: unknown, line: PayrollLine) => <Moment value={line.date} /> }],
                { title: 'Вид', dataIndex: 'kind', key: 'kind' },
                { title: 'Документ', key: 'document', render: (_value, line) => <RecordLink reference={line.document} /> },
                { title: 'Товар', dataIndex: 'goods', key: 'goods' },
                { title: 'База', key: 'base', align: 'right', render: (_value, line) => <Money value={line.base} /> },
                { title: 'Ставка, %', key: 'rate', align: 'right', render: (_value, line) => line.rate?.toLocaleString('ru-RU') ?? '' },
                { title: 'Начислено', key: 'amount', align: 'right', render: (_value, line) => <Money value={line.amount} /> },
                { title: 'Правило', dataIndex: 'rule', key: 'rule' },
            ]}
            summary={() => (
                <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={installments ? 7 : 6}><Typography.Text strong>Итого</Typography.Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right"><Typography.Text strong><Money value={totalOf(lines)} /></Typography.Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} />
                </Table.Summary.Row>
            )}
        />
    );
}

/**
 * Расшифровка начисления сотрудника: строка на каждый товар каждой части продажи или возврата
 * и строки бонусов. Бонусы по рассрочкам выведены отдельной таблицей с датами открытия
 * и закрытия рассрочки; возврат товара из рассрочки стоит в ней же, потому что вычитает бонус
 * рассрочки. Расшифровка стоит на вложенной поверхности внутри таблицы сотрудников: серый фон
 * показывает, к какой строке она относится.
 */
function EmployeeLines({ lines }: { readonly lines: ReadonlyArray<PayrollLine> }) {
    const installments = lines.filter(byInstallment);
    const others = lines.filter((line) => !byInstallment(line));
    return (
        <Layer>
            <Stack gap={5}>
                {others.length > 0 && (
                    <Stack gap={3}>
                        <Text.Heading variant="02">Бонусы за продажи</Text.Heading>
                        <LinesTable lines={others} installments={false} />
                    </Stack>
                )}
                {installments.length > 0 && (
                    <Stack gap={3}>
                        <Text.Heading variant="02">Бонусы за закрытые рассрочки</Text.Heading>
                        <LinesTable lines={installments} installments />
                    </Stack>
                )}
            </Stack>
        </Layer>
    );
}

/**
 * Начисление периода: итоги сотрудников, строка раскрывается в расшифровку. Начисленное
 * разделено на бонусы за продажи (с бонусами за выручку смены) и бонусы за рассрочки; их сумма равна «Начислено».
 */
function PayrollTable({ result }: { readonly result: PayrollResult }) {
    const employees = useObjectView(Objects.catalog.employees);
    const total = result.employees.reduce((sum, row) => sum + row.amount, 0);
    const installmentLines = result.lines.filter(byInstallment);
    const installmentsOf = (employee: string) => totalOf(installmentLines.filter((line) => line.employee === employee));
    return (
        <Table
            size="small"
            pagination={false}
            rowKey="employee"
            dataSource={[...result.employees]}
            expandable={{ expandedRowRender: (row) => <EmployeeLines lines={result.lines.filter((line) => line.employee === row.employee)} /> }}
            columns={[
                // Без права читать сотрудников сервер их описание не отдаёт.
                { title: 'Сотрудник', key: 'employee', render: (_value, row) => employees === undefined ? 'Нет доступа' : <EmployeeName view={employees} guid={row.employee} /> },
                { title: 'За продажи', key: 'sales', align: 'right', render: (_value, row) => <Money value={row.amount - installmentsOf(row.employee)} /> },
                { title: 'За закрытые рассрочки', key: 'installments', align: 'right', render: (_value, row) => <Money value={installmentsOf(row.employee)} /> },
                { title: 'Начислено', key: 'amount', align: 'right', render: (_value, row) => <Money value={row.amount} /> },
            ]}
            summary={() => (
                <Table.Summary.Row>
                    {/* Первая ячейка стоит под колонкой кнопок раскрытия. */}
                    <Table.Summary.Cell index={0} />
                    <Table.Summary.Cell index={1}><Typography.Text strong>Итого</Typography.Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right"><Typography.Text strong><Money value={total - totalOf(installmentLines)} /></Typography.Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right"><Typography.Text strong><Money value={totalOf(installmentLines)} /></Typography.Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={4} align="right"><Typography.Text strong><Money value={total} /></Typography.Text></Table.Summary.Cell>
                </Table.Summary.Row>
            )}
        />
    );
}

/**
 * Страница «Зарплата»: предварительное начисление незакрытого периода по выбранный день, по умолчанию
 * по сегодняшний. День выбирается датой без времени: период считается целыми днями.
 * Кнопка «Правила» показывает действующие правила с описаниями; их отдаёт тот же расчёт.
 * Расчёт выполняет сервер действием «Расчёт зарплаты» закрытия периода: та же функция считает
 * начисление при закрытии, поэтому цифры страницы совпадают с закрытием по тот же день.
 *
 * Кнопка «Закрыть период» есть только у пользователя с правом на это действие: сервер не отдаёт
 * описание действия без права. Окно предлагает выбранный день расчёта, если он уже прошёл, иначе
 * вчерашний: сегодняшним днём период закрыть нельзя.
 * После закрытия открывается созданный документ, а расчёт перечитывается сам: действие сбрасывает
 * сохранённые ответы сервера.
 */
export default function PayrollPage() {
    const closings = Objects.document.periodClosing;
    const view = useObjectView(closings);
    const [through, setThrough] = useState<string>(() => dayFromToday(0));
    const [rulesOpen, setRulesOpen] = useState(false);
    const [tab, setTab] = useState('current');
    const preview = useActionResult<PayrollResult>({ object: closings, action: 'payrollPreview', payload: { closedThrough: through } });
    const run = useAction();
    const openRecord = useOpenRecord();
    const [closing, setClosing] = useState(false);
    const closePeriod = view?.form?.actions.find((action) => action.name === 'closePeriod');
    const result = preview.data;
    const minimumDay = result?.periodStart ?? undefined;
    const lastClosingDay = dayFromToday(-1);
    // Если сотрудник закрыл период по выбранный день, прежний конец уже недоступен.
    // Новый расчёт начинается с первого открытого дня; граница берётся из ответа сервера.
    useEffect(() => {
        if (minimumDay !== undefined && through < minimumDay) setThrough(minimumDay);
    }, [minimumDay, through]);
    return (
        <Page
            title="Зарплата"
            actions={(
                <Flex gap="small">
                    {/* Ссылка, а не обработчик: переход по адресу страницы открывает её во вкладке. */}
                    <Link to={pagePath('periodSummary')}><Button>Сводка за период</Button></Link>
                    {tab === 'current' && <Button disabled={result === undefined} onClick={() => setRulesOpen(true)}>Правила</Button>}
                    {tab === 'current' && closePeriod !== undefined && <Button type="primary" disabled={result === undefined || preview.loading || (minimumDay !== undefined && minimumDay > lastClosingDay)} onClick={() => setClosing(true)}>{closePeriod.title}</Button>}
                </Flex>
            )}
        >
            <Tabs activeKey={tab} onChange={setTab} items={[
                { key: 'current', label: 'Текущий период', children: (
                    <Panel>
                        <Stack gap={5}>
                            {/* Поля стоят в колонках сетки, как поля форм: по четыре колонки на поле. */}
                            <Grid gutter="narrow">
                                <Column span={{ md: 4 }}>
                                    <FluidField label="Начало периода">
                                        {/* Начало приходит вместе с расчётом: после закрытия обновляется тем же запросом.
                                            Отображение без поля ввода не позволяет выбрать произвольное начало периода. */}
                                        <FluidValue content="text">
                                            {result === undefined
                                                ? <Typography.Text type="secondary">{preview.loading ? 'Загрузка…' : 'Нет данных'}</Typography.Text>
                                                : result.periodStart === null ? 'С начала учёта' : <FieldDisplay field={dayField} value={result.periodStart} />}
                                        </FluidValue>
                                    </FluidField>
                                </Column>
                                <Column span={{ md: 4 }}>
                                    <FluidField label="Рассчитать по" required>
                                        {/* Пустое значение не принимается: расчёт всегда идёт по какой-то день. */}
                                        <FieldInput field={dayField} value={through} disabled={result === undefined} dateLimits={{ minimum: minimumDay }} onChange={(value) => { if (typeof value === 'string') setThrough(value); }} />
                                    </FluidField>
                                </Column>
                            </Grid>
                            {minimumDay !== undefined && <Text tone="secondary">Период закрыт по <FieldDisplay field={dayField} value={dayBefore(minimumDay)} /> включительно.</Text>}
                            {result === undefined ? (
                                preview.loading
                                    ? <Typography.Text type="secondary">Загрузка…</Typography.Text>
                                    : <Alert type="error" showIcon title="Не удалось рассчитать зарплату" description="Нет права на расчёт зарплаты, или сервер отклонил запрос" />
                            ) : (
                                <Flex vertical gap="middle">
                                    <Typography.Text>
                                        Незакрытый период {result.periodStart === null ? 'с начала учёта' : <>с <FieldDisplay field={dayField} value={result.periodStart} /></>} по <FieldDisplay field={dayField} value={result.closedThrough} />.
                                    </Typography.Text>
                                    {result.employees.length === 0
                                        ? <Typography.Text type="secondary">Начислений в периоде нет</Typography.Text>
                                        : <PayrollTable result={result} />}
                                </Flex>
                            )}
                        </Stack>
                    </Panel>
                ) },
                { key: 'closed', label: 'Закрытые периоды', children: <ClosedPeriods /> },
            ]} />
            {closing && closePeriod !== undefined && (
                <ActionDialog
                    dateLimits={{ closedThrough: { minimum: minimumDay, maximum: lastClosingDay } }}
                    action={{ ...closePeriod, input: closePeriod.input.map((field) => field.name === 'closedThrough' ? { ...field, initial: through < dayFromToday(0) ? through : dayFromToday(-1) } : field) }}
                    onExecute={async (input) => {
                        const created: { readonly guid: string } = await run({ object: closings, action: 'closePeriod', payload: input, successMessage: 'Период закрыт', failureMessage: 'Период не закрыт' });
                        void openRecord(closings, created.guid);
                    }}
                    onClose={() => setClosing(false)}
                />
            )}
            {rulesOpen && result !== undefined && <RulesDialog title={result.rules} rules={result.ruleDescriptions} onClose={() => setRulesOpen(false)} />}
        </Page>
    );
}
