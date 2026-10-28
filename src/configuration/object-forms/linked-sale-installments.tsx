/** Формы связанных рассрочек в обычном просмотре продажи, без права на её изменение. */
import { Alert, Flex, Typography } from 'antd';
import { useState } from 'react';
import { ActionDialog, Button, Icons, useAction, useActionResult, useObjectView, useRecords, type FormValues, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { InstallmentPayments, LinkedInstallmentForm, paidAmount, type LinkedInstallment } from './linked-installment-form';

interface InstallmentListPage {
    readonly items: ReadonlyArray<{ readonly guid: string }>;
    readonly total: number;
}

/** Нет чтения рассрочек: ни формы, ни запросы к ним не создаются. */
export function LinkedSaleInstallments({ sale }: { readonly sale: string }) {
    const view = useObjectView(Objects.document.saleInstallment);
    return view?.form == null ? null : <InstallmentsPage sale={sale} view={view} page={1} />;
}

/**
 * Читает все связанные записи по страницам, затем получает полные данные пакетами get.
 * Просмотр не вызывает changesState: право на изменение продажи ему не требуется.
 * Оба запроса перечитываются стандартным сбросом SDK после взноса или закрытия.
 */
function InstallmentsPage({ sale, view, page }: { readonly sale: string; readonly view: ObjectView; readonly page: number }) {
    const list = useActionResult<InstallmentListPage>({ object: Objects.document.saleInstallment, action: 'list', payload: {
        filter: [{ field: 'sale', operator: 'equals', value: sale }, { field: 'deletedAt', operator: 'equals', value: null }],
        sort: [{ field: 'date', direction: 'ascending' }, { field: 'number', direction: 'ascending' }, { field: 'guid', direction: 'ascending' }], page, pageSize: 100,
    } });
    const records = useRecords(Objects.document.saleInstallment, list.data?.items.map((item) => item.guid) ?? []);
    if (records.error !== null) return <Alert type="error" showIcon title="Не удалось прочитать рассрочки" description={records.error.message} />;
    if (list.data === undefined) return list.loading ? <Typography.Text type="secondary">Загрузка рассрочек…</Typography.Text> : <Alert type="error" title="Не удалось прочитать рассрочки" />;
    return <>
        {list.data.items.map(({ guid }) => {
            const installment = records.records.get(guid);
            return installment === undefined ? null : <InstallmentView key={guid} installment={installment} view={view} loading={records.loading} />;
        })}
        {page * 100 < list.data.total && <InstallmentsPage sale={sale} view={view} page={page + 1} />}
    </>;
}

/** Последняя дата взноса служит исходной датой разрешённого закрытия. */
const closingDate = (installment: LinkedInstallment) => installment.payments.reduce<string | null>((latest, payment) => payment.date !== null && (latest === null || new Date(payment.date).getTime() > new Date(latest).getTime()) ? payment.date : latest, null);

/**
 * Взнос и закрытие выполняются над конкретной рассрочкой, не записывая форму продажи.
 * Таблица просмотра перечитывается из кеша после действия; локальной копии записи здесь нет.
 */
function InstallmentView({ installment, view, loading }: { readonly installment: LinkedInstallment; readonly view: ObjectView; readonly loading: boolean }) {
    const form = view.form;
    if (form === null) return null;
    const paymentsPart = form.tableParts.find((part) => part.name === 'payments');
    return <LinkedInstallmentForm installment={installment} fields={form.fields} person={installment.person} employee={installment.responsibleEmployee}
        amount={installment.amount} paid={paidAmount(installment.payments)} payments={paymentsPart === undefined ? null : <InstallmentPayments key={JSON.stringify(installment.payments)} part={paymentsPart} payments={installment.payments} disabled />}>
        <LinkedInstallmentActions installment={installment} view={view} disabled={loading} />
    </LinkedInstallmentForm>;
}

/**
 * Общие кнопки просмотра и редактора. Права определяют наличие, состояние и режим определяют
 * доступность: закрытая и непроведённая рассрочки и редактор сохраняют недоступные кнопки.
 * Банковской рассрочке эти действия не предлагаются.
 */
export function LinkedInstallmentActions({ installment, view, disabled = false }: { readonly installment: LinkedInstallment; readonly view: ObjectView; readonly disabled?: boolean }) {
    const [dialog, setDialog] = useState<'pay' | 'close' | null>(null);
    const execute = useAction();
    const form = view.form;
    if (form === null || installment.type !== 'Собственная') return null;
    const paid = paidAmount(installment.payments);
    const balance = installment.amount - paid;
    const actionable = !disabled && installment.posted && installment.closedAt === null && (installment.deletedAt ?? null) === null;
    const pay = form.actions.find((action) => action.name === 'pay');
    const close = form.actions.find((action) => action.name === 'close');
    const action = dialog === 'pay' ? pay : dialog === 'close' ? close : undefined;
    const run = async (input: FormValues) => {
        if (action === undefined || dialog === null || !actionable) return;
        await execute({ object: Objects.document.saleInstallment, action: dialog, payload: { ...input, installment: installment.guid }, successMessage: dialog === 'pay' ? 'Взнос принят' : 'Рассрочка закрыта' });
    };
    return <>
        {/* Крупные кнопки (48 px) удобнее находить и нажимать после просмотра взносов. */}
        <Flex gap="middle" wrap>
            {pay !== undefined && <Button type="primary" size="lg" icon={<Icons.acceptPayment />} disabled={!actionable || balance <= 0} onClick={() => setDialog('pay')}>Взнос</Button>}
            {close !== undefined && <Button size="lg" icon={<Icons.closeInstallment />} disabled={!actionable || balance !== 0} onClick={() => setDialog('close')}>Закрыть</Button>}
        </Flex>
        {action !== undefined && <ActionDialog action={{ ...action, input: action.input.filter((field) => field.name !== 'installment').map((field) => field.name === 'closedAt' ? { ...field, initial: closingDate(installment) } : field) }} onExecute={run} onClose={() => setDialog(null)} />}
    </>;
}
