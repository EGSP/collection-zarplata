/**
 * Экран «Внести изменения» на форме проведённой продажи: части рассрочек под продажей,
 * распределение изменения суммы по рассрочкам и совместная запись действием продажи
 * `saveChanges`. Продажу сотрудник меняет в той же форме выше; здесь собраны рассрочки,
 * проверки и кнопки экрана.
 *
 * Правила, которые здесь проверяются заранее, повторяет сервер: экран лишь не даёт отправить
 * изменения, которые сервер отклонит, и объясняет причину.
 */
import { Alert, Button, Flex, Form, Typography, type FormInstance } from 'antd';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    ApiError,
    FieldDisplay,
    FieldInput,
    saveFields,
    useAction,
    useActionConfirmation,
    useActionResult,
    useObjectView,
    type FormAction,
    type FormField,
    type FormValues,
    type RecordFormState,
} from '../../web/sdk';
import { InstallmentDivider, InstallmentPayments, Labelled, LinkedInstallmentForm, installmentTitle, paidAmount, type InstallmentPayment, type LinkedInstallment } from './linked-installment-form';
import { LinkedInstallmentActions } from './linked-sale-installments';
import { Objects } from '../objects.generated';
import { emptyInstallmentTerms, installmentTermsInput, installmentTermsProblems, SaleInstallmentBlock, type SaleInstallmentTerms } from './sale-installment-block';

/**
 * Способ строки оплаты, на сумму которой оформлены рассрочки. Совпадает с `installmentMethod`
 * из `payments.ts`; константа оттуда не импортируется, потому что это серверный модуль.
 */
const installmentMethod = 'Рассрочка';

/** Способ оплаты продажи из нескольких оплат. Совпадает с `complexPayment` продажи. */
const complexPayment = 'Сложная';

/** Ответ действия `changesState`: продажа, её рассрочки и версия данных. */
interface ChangesState {
    readonly sale: { readonly payments: ReadonlyArray<PaymentLine> };
    readonly installments: ReadonlyArray<LinkedInstallment>;
    readonly version: string;
}

/** Строка оплаты на форме: до записи любая ячейка может быть пустой. */
interface PaymentLine {
    readonly method?: unknown;
    readonly amount?: unknown;
}

/** Сумма оплат способом «Рассрочка» с суммой. */
const installmentLine = (payments: unknown): number => Array.isArray(payments)
    ? (payments as ReadonlyArray<PaymentLine>).filter((line) => line.method === installmentMethod && typeof line.amount === 'number').reduce((total, line) => total + (line.amount as number), 0)
    : 0;

/**
 * Сумма в копейках рублями со знаком валюты, как `rubles` из `money.ts`: тот модуль серверный
 * и в сборку клиента не входит.
 */
const rubles = (kopecks: number) => `${(kopecks / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;

/**
 * Участвует ли рассрочка в распределении: проведена. Непроведённая рассрочка итог регистра
 * «Неоформленные рассрочки» не уменьшает. Закрытая участвует: изменение снимает с неё закрытие.
 */
const distributable = (installment: LinkedInstallment) => installment.posted;

/**
 * Распределяет изменение суммы рассрочек по проведённым рассрочкам, начиная с последней.
 * Увеличение целиком достаётся последней рассрочке: её покупатель оформил позже остальных.
 * Уменьшение снимается с последних рассрочек, пока сумма каждой не дойдёт до её взносов
 * (`paymentsOf`, с правками экрана) и не меньше 1 ₽. Возвращает новые суммы; нераспределённый
 * остаток покажет проверка.
 */
function distribute(installments: ReadonlyArray<LinkedInstallment>, change: number, paymentsOf: (installment: LinkedInstallment) => ReadonlyArray<InstallmentPayment>): Map<string, number> {
    const amounts = new Map(installments.map((installment) => [installment.guid, installment.amount]));
    const open = installments.filter(distributable);
    const last = open.at(-1);
    if (change > 0 && last !== undefined) amounts.set(last.guid, last.amount + change);
    let left = -change;
    for (const installment of [...open].reverse()) {
        if (left <= 0) break;
        const reducible = Math.max(0, installment.amount - Math.max(paidAmount(paymentsOf(installment)), 1));
        const taken = Math.min(reducible, left);
        amounts.set(installment.guid, installment.amount - taken);
        left -= taken;
    }
    return amounts;
}

const money = { kind: 'money', target: null } as const;

/** Свойства экрана изменения. */
export interface SaleChangesProperties {
    readonly state: RecordFormState;
    /** Готовит значения продажи перед записью так же, как форма: сложную оплату из одной строки делает простой. */
    readonly prepare: (values: FormValues) => FormValues | undefined;
    /** Изменения записаны либо сотрудник отказался от них: экран закрывается. */
    readonly onClose: () => void;
}

/**
 * Части рассрочек и кнопки экрана изменения.
 *
 * Данные рассрочек экран читает действием `changesState` вместе с версией. При записи версия
 * уходит на сервер, и если другой пользователь успел изменить продажу или рассрочку, например
 * принять взнос, сервер отклоняет запись. Экран тогда перечитывает рассрочки, а введённые
 * значения продажи остаются на форме: сотрудник проверяет новый расчёт и сохраняет снова.
 *
 * Сумма рассрочек следует за оплатой способом «Рассрочка»: изменение этой оплаты распределяется
 * по проведённым рассрочкам (`distribute`), в том числе закрытым: любое изменение закрытой
 * рассрочки снимает с неё закрытие, и экран об этом предупреждает. Несколько рассрочек бывает
 * только у продаж, оформленных до правила об одной рассрочке; у них сотрудник может задать суммы
 * сам, а экран показывает, сколько распределено и сколько осталось.
 * После изменения оплату «Рассрочка» покрывают рассрочки целиком: неоформленной суммы, на которую
 * понадобился бы черновик рассрочки, не остаётся. Если рассрочки у продажи нет (например, продажа
 * была за наличные), экран выводит блок условий новой рассрочки, как форма новой продажи: тип,
 * покупатель, ответственный, ставка и первоначальный взнос. Сохранение оформляет и проводит
 * рассрочку с этими условиями. Вторую рассрочку к имеющейся сервер не оформляет.
 *
 * При способе «Сложная» сумма строки «Рассрочка» следует за суммой продажи: остальные оплаты
 * сохраняются, а рассрочка получает разницу. Так уменьшение продажи при той же наличной оплате
 * уменьшает рассрочку.
 */
export function SaleChanges({ state, prepare, onClose }: SaleChangesProperties) {
    const sales = Objects.document.sale;
    const record = state.record;
    const guid = typeof record?.['guid'] === 'string' ? record['guid'] : null;
    const performAction = useAction();
    const confirmation = useActionConfirmation();
    const installmentView = useObjectView(Objects.document.saleInstallment);
    const changes = useActionResult<ChangesState>({ object: sales, action: 'changesState', payload: { sale: guid }, enabled: guid !== null });
    const data = changes.data;
    const [saving, setSaving] = useState(false);
    // Суммы, заданные сотрудником; `null` — суммы распределяются автоматически.
    const [manual, setManual] = useState<ReadonlyMap<string, number | null> | null>(null);
    const [persons, setPersons] = useState<ReadonlyMap<string, unknown>>(new Map());
    const [employees, setEmployees] = useState<ReadonlyMap<string, unknown>>(new Map());
    // Взносы, изменённые на экране, по рассрочкам; у остальных рассрочек взносы прежние.
    const [editedPayments, setEditedPayments] = useState<ReadonlyMap<string, ReadonlyArray<InstallmentPayment>>>(new Map());
    const paymentForms = useRef(new Set<FormInstance>());
    const [terms, setTerms] = useState<SaleInstallmentTerms>(emptyInstallmentTerms);
    // Ошибки условий новой рассрочки показываются после первой попытки сохранить, как при продаже.
    const [termsChecked, setTermsChecked] = useState(false);
    const shift: unknown = Form.useWatch('shift', { form: state.form, preserve: true });
    const sellWithInstallment = state.view.actions.find((action) => action.name === 'sellWithInstallment');
    const cancelAction = state.view.actions.find((action) => action.name === 'cancel');

    const payments: unknown = Form.useWatch('payments', { form: state.form, preserve: true });
    const mode: unknown = Form.useWatch('paymentMode', { form: state.form, preserve: true });
    const amount: unknown = Form.useWatch('amount', { form: state.form, preserve: true });
    const saleAmount = typeof amount === 'number' ? amount : 0;

    // Строка «Рассрочка» сложной оплаты следует за суммой продажи: при её изменении строка получает
    // разницу между суммой продажи и остальными оплатами. Ручная правка строк этим не отменяется.
    const previousAmount = useRef(saleAmount);
    useEffect(() => {
        const before = previousAmount.current;
        previousAmount.current = saleAmount;
        if (before === saleAmount || mode !== complexPayment || !Array.isArray(payments)) return;
        const rows = payments as ReadonlyArray<PaymentLine>;
        const index = rows.findIndex((line) => line.method === installmentMethod);
        if (index === -1) return;
        const others = rows.reduce((total, line, position) => total + (position !== index && typeof line.amount === 'number' ? line.amount : 0), 0);
        const next = saleAmount - others;
        if (next > 0 && rows[index]?.amount !== next) {
            state.form.setFieldValue(['payments', index, 'amount'], next);
            state.markChanged();
        }
        // Эффект отвечает только на изменение суммы продажи: строки оплат он читает текущими.
    }, [saleAmount]);

    const installments = data?.installments ?? [];
    const line = installmentLine(payments);
    const previousLine = installmentLine(data?.sale.payments);
    const arrangedBefore = installments.filter((installment) => installment.posted).reduce((total, installment) => total + installment.amount, 0);
    // Оплату «Рассрочка» после изменения покрывают рассрочки целиком, в том числе сумму, не покрытую до изменения.
    const target = line;
    const paymentsOf = (installment: LinkedInstallment) => editedPayments.get(installment.guid) ?? installment.payments;
    const automatic = useMemo(() => distribute(installments, target - arrangedBefore, paymentsOf), [data, target, editedPayments]);
    const amountOf = (installment: LinkedInstallment): number => manual?.get(installment.guid) ?? (manual === null ? automatic.get(installment.guid) ?? installment.amount : installment.amount);
    const distributed = installments.filter((installment) => installment.posted).reduce((total, installment) => total + amountOf(installment), 0);
    const editableAmounts = installments.filter(distributable).length > 1;

    // Оплата «Рассрочка» продажи без рассрочки: её получает новая рассрочка. Вторая рассрочка не оформляется.
    const newAmount = installments.length > 0 ? 0 : Math.max(0, target - distributed);
    const termsProblems = newAmount > 0 ? installmentTermsProblems(terms, newAmount) : [];

    const problems: string[] = [];
    let recommendCancel = false;
    if (newAmount > 0) {
        // Ошибки условий новой рассрочки показывает её блок; сохранение проверяет их само.
    } else if (installments.length > 0 && line <= 0) {
        problems.push(`У продажи есть рассрочки: в оплате должна остаться оплата способом «${installmentMethod}». Отказаться от рассрочки можно только отменой продажи.`);
        recommendCancel = true;
    } else if (installments.length > 0 && distributed !== target) {
        const left = target - distributed;
        problems.push(left > 0
            ? `Не распределено по рассрочкам: ${rubles(left)}.`
            : `Рассрочки превышают оплату способом «${installmentMethod}» на ${rubles(-left)}.`);
        // Уменьшение, которое не помещается в открытые рассрочки, изменением не провести.
        if (manual === null && left < 0) recommendCancel = true;
    }
    for (const installment of installments) {
        const paid = paidAmount(paymentsOf(installment));
        if (amountOf(installment) < paid) problems.push(`${installmentTitle(installment)}: сумма ${rubles(amountOf(installment))} меньше взносов ${rubles(paid)}.`);
    }

    const divider = <InstallmentDivider />;

    const field = (name: string): FormField | undefined => installmentView?.form?.fields.find((candidate) => candidate.name === name);
    const paymentsPart = installmentView?.form?.tableParts.find((part) => part.name === 'payments');

    const save = async () => {
        if (data === undefined || guid === null) return;
        const prepared = prepare(state.form.getFieldsValue(true) as FormValues);
        if (prepared !== undefined) state.form.setFieldsValue(prepared);
        let entered: FormValues;
        try {
            entered = await state.form.validateFields();
            // Строки взносов проверяются по правилам своих колонок, как строки продажи.
            await Promise.all([...paymentForms.current].map((form) => form.validateFields()));
        } catch {
            return;
        }
        const fields = saveFields(state.view, record, entered);
        if (newAmount > 0) {
            setTermsChecked(true);
            if (termsProblems.length > 0) return;
        }
        const newInstallment = newAmount > 0 ? installmentTermsInput(terms) : null;
        setSaving(true);
        try {
            await performAction({
                object: sales,
                action: 'saveChanges',
                payload: {
                    sale: guid,
                    version: data.version,
                    paymentMode: fields['paymentMode'],
                    ...(newInstallment === null ? {} : {
                        newInstallmentType: newInstallment.type,
                        newInstallmentPerson: newInstallment.person,
                        newInstallmentResponsibleEmployee: newInstallment.responsibleEmployee,
                        newInstallmentRate: newInstallment.rate,
                        newInstallmentInitialMethod: newInstallment.initialMethod,
                        newInstallmentInitialAmount: newInstallment.initialAmount,
                        newInstallmentInitialReceiver: newInstallment.initialReceiver,
                    }),
                    goods: fields['goods'],
                    payments: fields['payments'],
                    installments: installments.map((installment) => ({
                        installment: installment.guid,
                        type: installment.type,
                        amount: amountOf(installment),
                        person: persons.has(installment.guid) ? persons.get(installment.guid) : installment.person,
                        responsibleEmployee: employees.has(installment.guid) ? employees.get(installment.guid) : installment.responsibleEmployee,
                    })),
                    installmentPayments: installments.flatMap((installment) => paymentsOf(installment).map((payment) => ({
                        installment: installment.guid, date: payment.date, method: payment.method, amount: payment.amount, receiver: payment.receiver ?? null, shift: payment.shift ?? null,
                    }))),
                },
                successMessage: 'Изменения сохранены',
                failureMessage: 'Не удалось сохранить изменения',
            });
            await state.reloadRecord();
            onClose();
        } catch (error) {
            // Отказ мог быть вызван изменением данных в другой сессии: рассрочки перечитываются,
            // введённые значения продажи остаются на форме. Текст отказа показало уведомление.
            if (error instanceof ApiError && error.statusCode === 409) {
                setManual(null);
                setEditedPayments(new Map());
                await changes.refresh();
            }
        } finally {
            setSaving(false);
        }
    };

    /** Отказ от изменений: форма снова показывает записанную продажу. */
    const discard = async () => {
        await state.reloadRecord();
        onClose();
    };

    /** «Отмена продажи» с экрана изменения: введённые изменения не записываются. */
    const cancelSale = async (action: FormAction) => {
        if (guid === null || !(await confirmation.confirm(action))) return;
        try {
            await performAction({ object: sales, action: 'cancel', payload: { sale: guid }, successMessage: action.title });
            await discard();
        } catch {
            // Об отказе сообщило уведомление.
        }
    };

    return (
        <>
            {installments.map((installment) => {
                const next = amountOf(installment);
                const amountField = field('amount');
                return <LinkedInstallmentForm key={installment.guid} installment={installment} fields={installmentView?.form?.fields ?? []}
                    editing disabled={saving} person={persons.has(installment.guid) ? persons.get(installment.guid) : installment.person}
                    employee={employees.has(installment.guid) ? employees.get(installment.guid) : installment.responsibleEmployee}
                    onPersonChange={(value) => setPersons((current) => new Map(current).set(installment.guid, value))}
                    onEmployeeChange={(value) => setEmployees((current) => new Map(current).set(installment.guid, value))}
                    amount={next} paid={paidAmount(paymentsOf(installment))}
                    amountInput={editableAmounts && distributable(installment) && amountField !== undefined ? <div style={{ width: 160 }}>
                        <FieldInput field={amountField} value={next} disabled={saving}
                            onChange={(value) => setManual((current) => new Map(current ?? installments.map((candidate) => [candidate.guid, amountOf(candidate)])).set(installment.guid, typeof value === 'number' ? value : null))} />
                    </div> : undefined}
                    difference={<Typography.Text {...(next === installment.amount ? { type: 'secondary' as const } : {})}>
                        {next === installment.amount ? 'нет' : `${next > installment.amount ? '+' : '−'}${rubles(Math.abs(next - installment.amount))}`}
                    </Typography.Text>}
                    payments={paymentsPart === undefined ? null : <InstallmentPayments key={data?.version} part={paymentsPart} payments={installment.payments}
                        disabled={saving || !installment.posted} register={(form) => { paymentForms.current.add(form); return () => paymentForms.current.delete(form); }}
                        onChange={(rows) => setEditedPayments((current) => new Map(current).set(installment.guid, rows))} />}>
                    {installmentView !== undefined && <LinkedInstallmentActions installment={installment} view={installmentView} disabled />}
                </LinkedInstallmentForm>;
            })}
            {newAmount > 0 && (
                <>
                    {divider}
                    <Flex vertical gap="middle" style={{ maxWidth: 480 }}>
                        <Flex align="baseline" gap="middle" wrap>
                            <Typography.Title level={4} style={{ margin: 0 }}>Новая рассрочка</Typography.Title>
                            <Typography.Text>на <FieldDisplay field={money} value={newAmount} /></Typography.Text>
                        </Flex>
                        <SaleInstallmentBlock terms={terms} onChange={setTerms} shift={typeof shift === 'string' ? shift : null} disabled={saving}
                            problems={termsChecked ? termsProblems : []} input={sellWithInstallment?.input ?? []} />
                    </Flex>
                </>
            )}
            {divider}
            <Flex vertical gap="middle">
                {installments.length > 0 && (
                    <Flex gap="large" wrap>
                        <Labelled title={`Оплата «${installmentMethod}» до изменения`}><FieldDisplay field={money} value={previousLine} /></Labelled>
                        <Labelled title={`Оплата «${installmentMethod}» после изменения`}><FieldDisplay field={money} value={line} /></Labelled>
                        <Labelled title="Распределено по рассрочкам"><FieldDisplay field={money} value={distributed} /></Labelled>
                        {manual !== null && (
                            <Flex align="flex-end">
                                <Button onClick={() => setManual(null)} disabled={saving}>Распределить автоматически</Button>
                            </Flex>
                        )}
                    </Flex>
                )}
                {installments.length > 0 && (
                    <Typography.Text type="secondary">
                        Тип рассрочки не меняется, и убрать рассрочку из продажи нельзя. Для таких изменений используйте «Отмена продажи» и оформите продажу заново.
                    </Typography.Text>
                )}
                {problems.length > 0 && (
                    <Alert
                        type="error"
                        showIcon
                        title={problems.map((problem) => <div key={problem}>{problem}</div>)}
                        action={recommendCancel && cancelAction !== undefined ? <Button danger onClick={() => void cancelSale(cancelAction)}>{cancelAction.title}</Button> : undefined}
                    />
                )}
                <Flex gap="middle" wrap>
                    <Button type="primary" size="large" loading={saving} disabled={data === undefined || changes.loading || problems.length > 0} onClick={() => void save()}>
                        Сохранить изменения
                    </Button>
                    <Button size="large" disabled={saving} onClick={() => void discard()}>Отменить изменения</Button>
                </Flex>
            </Flex>
            {confirmation.dialog}
        </>
    );
}
