import { Alert, Button, Card, Flex, Table, Typography } from 'antd';
import { useState } from 'react';
import { ActionDialog, FieldDisplay, Page, RecordLink, useAction, useActionResult, useObjectView, useOpenRecord, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';
import type { PayrollLine, PayrollResult } from '../payroll';

/** Вчерашний день датой `ГГГГ-ММ-ДД`: ближайшая граница, которой можно закрыть период. */
function yesterday(): string {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Представление сотрудника: код из справочника. */
function EmployeeName({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/** Денежная сумма в том же виде, что в формах. */
function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/** Расшифровка начисления сотрудника: строка на каждый товар каждой части продажи или возврата. */
function EmployeeLines({ lines }: { readonly lines: ReadonlyArray<PayrollLine> }) {
    return (
        <Table
            size="small"
            pagination={false}
            rowKey={(line) => `${line.document.guid}-${line.goods}-${line.kind}-${line.date}-${line.base}`}
            dataSource={[...lines]}
            columns={[
                { title: 'Дата', key: 'date', render: (_value, line) => <FieldDisplay field={{ kind: 'dateTime', target: null }} value={line.date} /> },
                { title: 'Вид', dataIndex: 'kind', key: 'kind' },
                { title: 'Документ', key: 'document', render: (_value, line) => <RecordLink reference={line.document} /> },
                { title: 'Товар', dataIndex: 'goods', key: 'goods' },
                { title: 'База', key: 'base', align: 'right', render: (_value, line) => <Money value={line.base} /> },
                { title: 'Ставка, %', dataIndex: 'rate', key: 'rate', align: 'right' },
                { title: 'Начислено', key: 'amount', align: 'right', render: (_value, line) => <Money value={line.amount} /> },
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
 * Страница «Зарплата»: предварительное начисление незакрытого периода по сегодняшний день.
 * Расчёт выполняет сервер действием «Расчёт зарплаты» закрытия периода: та же функция считает
 * начисление при закрытии, поэтому цифры страницы совпадают с закрытием по тот же день.
 *
 * Кнопка «Закрыть период» есть только у пользователя с правом на это действие: сервер не отдаёт
 * описание действия без права. Окно предлагает вчерашний день: сегодняшним период закрыть нельзя.
 * После закрытия открывается созданный документ, а расчёт перечитывается сам: действие сбрасывает
 * сохранённые ответы сервера.
 */
export default function PayrollPage() {
    const closings = Objects.document.periodClosing;
    const view = useObjectView(closings);
    const preview = useActionResult<PayrollResult>({ object: closings, action: 'payrollPreview' });
    const run = useAction();
    const openRecord = useOpenRecord();
    const [closing, setClosing] = useState(false);
    const closePeriod = view?.form?.actions.find((action) => action.name === 'closePeriod');
    const result = preview.data;
    return (
        <Page
            title="Зарплата"
            actions={closePeriod !== undefined && <Button type="primary" onClick={() => setClosing(true)}>{closePeriod.title}</Button>}
        >
            <Card size="small">
                {result === undefined ? (
                    preview.loading
                        ? <Typography.Text type="secondary">Загрузка…</Typography.Text>
                        : <Alert type="error" showIcon title="Не удалось рассчитать зарплату" description="Нет права на расчёт зарплаты, или сервер отклонил запрос" />
                ) : (
                    <Flex vertical gap="middle">
                        <Typography.Text>
                            Незакрытый период {result.periodStart === null ? 'с начала учёта' : <>с <FieldDisplay field={{ kind: 'date', target: null }} value={result.periodStart} /></>} по сегодня. Правила: {result.rules}.
                        </Typography.Text>
                        {result.employees.length === 0
                            ? <Typography.Text type="secondary">Начислений в периоде нет</Typography.Text>
                            : <PayrollTable result={result} />}
                    </Flex>
                )}
            </Card>
            {closing && closePeriod !== undefined && (
                <ActionDialog
                    action={{ ...closePeriod, input: closePeriod.input.map((field) => field.name === 'closedThrough' ? { ...field, initial: yesterday() } : field) }}
                    onExecute={async (input) => {
                        const created: { readonly guid: string } = await run({ object: closings, action: 'closePeriod', payload: input, successMessage: 'Период закрыт', failureMessage: 'Период не закрыт' });
                        void openRecord(closings, created.guid);
                    }}
                    onClose={() => setClosing(false)}
                />
            )}
        </Page>
    );
}
