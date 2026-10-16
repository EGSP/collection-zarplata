import { Alert, Button, Card, Flex, Modal, Table, Typography } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';
import { ActionDialog, FieldDisplay, FieldInput, FluidField, Page, pagePath, RecordLink, useAction, useActionResult, useObjectView, useOpenRecord, useReferencePresentation, type ObjectView } from '../../web/sdk';
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

/** Расшифровка начисления сотрудника: строка на каждый товар каждой части продажи или возврата и строки бонусов. */
function EmployeeLines({ lines }: { readonly lines: ReadonlyArray<PayrollLine> }) {
    return (
        <Table
            size="small"
            pagination={false}
            rowKey={(line) => `${line.document.guid}-${line.goods}-${line.kind}-${line.date}-${line.base}-${line.rule}`}
            dataSource={[...lines]}
            columns={[
                { title: 'Дата', key: 'date', render: (_value, line) => <FieldDisplay field={{ kind: 'dateTime', target: null }} value={line.date} /> },
                { title: 'Вид', dataIndex: 'kind', key: 'kind' },
                { title: 'Документ', key: 'document', render: (_value, line) => <RecordLink reference={line.document} /> },
                { title: 'Товар', dataIndex: 'goods', key: 'goods' },
                { title: 'База', key: 'base', align: 'right', render: (_value, line) => <Money value={line.base} /> },
                { title: 'Ставка, %', key: 'rate', align: 'right', render: (_value, line) => line.rate?.toLocaleString('ru-RU') ?? '' },
                { title: 'Начислено', key: 'amount', align: 'right', render: (_value, line) => <Money value={line.amount} /> },
                { title: 'Правило', dataIndex: 'rule', key: 'rule' },
            ]}
        />
    );
}

/** Начисление периода: итоги сотрудников, строка раскрывается в расшифровку. */
function PayrollTable({ result }: { readonly result: PayrollResult }) {
    const employees = useObjectView(Objects.catalog.employees);
    const total = result.employees.reduce((sum, row) => sum + row.amount, 0);
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
                { title: 'Начислено', key: 'amount', align: 'right', render: (_value, row) => <Money value={row.amount} /> },
            ]}
            summary={() => (
                <Table.Summary.Row>
                    {/* Первая ячейка стоит под колонкой кнопок раскрытия. */}
                    <Table.Summary.Cell index={0} />
                    <Table.Summary.Cell index={1}><Typography.Text strong>Итого</Typography.Text></Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right"><Typography.Text strong><Money value={total} /></Typography.Text></Table.Summary.Cell>
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
    const preview = useActionResult<PayrollResult>({ object: closings, action: 'payrollPreview', payload: { closedThrough: through } });
    const run = useAction();
    const openRecord = useOpenRecord();
    const [closing, setClosing] = useState(false);
    const closePeriod = view?.form?.actions.find((action) => action.name === 'closePeriod');
    const result = preview.data;
    return (
        <Page
            title="Зарплата"
            actions={(
                <Flex gap="small">
                    {/* Ссылка, а не обработчик: переход по адресу страницы открывает её во вкладке. */}
                    <Link to={pagePath('periodSummary')}><Button>Сводка за период</Button></Link>
                    <Button disabled={result === undefined} onClick={() => setRulesOpen(true)}>Правила</Button>
                    {closePeriod !== undefined && <Button type="primary" onClick={() => setClosing(true)}>{closePeriod.title}</Button>}
                </Flex>
            )}
        >
            <Card size="small">
                <div style={{ maxWidth: 240, marginBottom: 16 }}>
                    <FluidField label="Рассчитать по" required>
                        {/* Пустое значение не принимается: расчёт всегда идёт по какой-то день. */}
                        <FieldInput field={dayField} value={through} onChange={(value) => { if (typeof value === 'string') setThrough(value); }} />
                    </FluidField>
                </div>
                {result === undefined ? (
                    preview.loading
                        ? <Typography.Text type="secondary">Загрузка…</Typography.Text>
                        : <Alert type="error" showIcon title="Не удалось рассчитать зарплату" description="Нет права на расчёт зарплаты, или сервер отклонил запрос" />
                ) : (
                    <Flex vertical gap="middle">
                        <Typography.Text>
                            Незакрытый период {result.periodStart === null ? 'с начала учёта' : <>с <FieldDisplay field={dayField} value={result.periodStart} /></>} по <FieldDisplay field={dayField} value={result.closedThrough} />. Правила: {result.rules}.
                        </Typography.Text>
                        {result.employees.length === 0
                            ? <Typography.Text type="secondary">Начислений в периоде нет</Typography.Text>
                            : <PayrollTable result={result} />}
                    </Flex>
                )}
            </Card>
            {closing && closePeriod !== undefined && (
                <ActionDialog
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
