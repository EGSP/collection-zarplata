/** Общие части рассрочки в просмотре продажи и на экране совместного изменения. */
import { Button, Divider, Flex, Form, Tag, theme, Typography, type FormInstance } from 'antd';
import { useEffect, useRef, type ReactNode } from 'react';
import { FieldDisplay, FieldInput, Icons, TablePart, useOpenRecord, type FormField, type FormTablePart, type FormValues } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Взнос в редакторе может содержать ещё не заполненные поля. */
export interface InstallmentPayment {
    readonly date: string | null;
    readonly method: string | null;
    readonly amount: number | null;
    readonly receiver: unknown;
    readonly shift: string | null;
}

/** Общие сохранённые сведения рассрочки из get и changesState. */
export interface LinkedInstallment {
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly type: string | null;
    readonly rate?: string | null;
    readonly person: string | null;
    readonly responsibleEmployee: string | null;
    readonly amount: number;
    readonly closedAt: string | null;
    readonly posted: boolean;
    readonly deletedAt?: string | null;
    readonly payments: ReadonlyArray<InstallmentPayment>;
}

/** Сумма заполненных взносов в копейках. */
export const paidAmount = (payments: ReadonlyArray<InstallmentPayment>) => payments.reduce((total, payment) => total + (payment.amount ?? 0), 0);
/** Заголовок присоединённой формы. */
export const installmentTitle = (installment: LinkedInstallment) => `Рассрочка № ${installment.number} от ${new Date(installment.date).toLocaleDateString('ru-RU')}`;

/** Поле с подписью над значением, одинаковое в просмотре и изменении. */
export function Labelled({ title, children }: { readonly title: string; readonly children: ReactNode }) {
    return <Flex vertical gap={4} style={{ minWidth: 180 }}><Typography.Text type="secondary">{title}</Typography.Text>{children}</Flex>;
}

/** Разделяет продажу и рассрочки, сохраняя одинаковые границы в обоих режимах. */
export function InstallmentDivider() {
    const { token } = theme.useToken();
    return <Divider variant="dashed" style={{ margin: '24px 0', borderTopWidth: 2, borderColor: token.colorTextTertiary }} />;
}

interface LinkedInstallmentFormProperties {
    readonly installment: LinkedInstallment;
    readonly fields: ReadonlyArray<FormField>;
    readonly editing?: boolean;
    readonly disabled?: boolean;
    readonly person: unknown;
    readonly employee: unknown;
    readonly onPersonChange?: (value: unknown) => void;
    readonly onEmployeeChange?: (value: unknown) => void;
    /** Сумма с учётом распределения; в просмотре равна записанной. */
    readonly amount: number;
    readonly paid: number;
    readonly amountInput?: ReactNode;
    readonly difference?: ReactNode;
    readonly payments: ReactNode;
    /** Действия просмотра располагаются после взносов и остатков. */
    readonly children?: ReactNode;
}

const money = { kind: 'money', target: null } as const;

/**
 * Раскладка не читает и не записывает данные. Просмотр получает сохранённые значения, редактор
 * передаёт свои значения и обработчики. Условия, состояние и итоги поэтому не расходятся.
 * Переход в отдельную рассрочку явно открывает оригинал, минуя правило возврата в продажу.
 */
export function LinkedInstallmentForm({ installment, fields, editing = false, disabled = false, person, employee, onPersonChange, onEmployeeChange, amount, paid, amountInput, difference, payments, children }: LinkedInstallmentFormProperties) {
    const openRecord = useOpenRecord();
    const reference = (name: string, value: unknown, onChange: ((value: unknown) => void) | undefined, width: number) => {
        const field = fields.find((candidate) => candidate.name === name);
        if (field === undefined) return null;
        return <Labelled title={field.title}><div style={{ width, maxWidth: '100%' }}>
            {editing && onChange !== undefined ? <FieldInput field={field} disabled={disabled} value={value} onChange={onChange} /> : <FieldDisplay field={field} value={value} />}
        </div></Labelled>;
    };
    return <section aria-label={installmentTitle(installment)}>
        <InstallmentDivider />
        <Flex vertical gap="middle">
            <Flex align="center" gap="middle" wrap>
                <Typography.Title level={4} style={{ margin: 0 }}>{installmentTitle(installment)}</Typography.Title>
                <Button type="text" disabled={false} icon={<Icons.open />} aria-label="Открыть рассрочку" title="Открыть рассрочку"
                    onClick={() => void openRecord(Objects.document.saleInstallment, installment.guid, 'tab', { original: true })} />
                {installment.type !== null && <Tag style={{ marginInlineEnd: 0 }}>{installment.type}</Tag>}
                <Tag {...(installment.closedAt === null ? {} : { color: 'green' })} style={{ marginInlineEnd: 0 }}>
                    {installment.closedAt !== null ? <>Закрыта <FieldDisplay field={{ kind: 'dateTime', target: null }} value={installment.closedAt} /></> : installment.posted ? 'Открыта' : 'Черновик'}
                </Tag>
            </Flex>
            {editing && installment.closedAt !== null && <Typography.Text type="secondary">Любое изменение снимет с рассрочки закрытие. После сохранения закройте её заново.</Typography.Text>}
            <Flex gap="large" wrap>
                {reference('person', person, onPersonChange, 320)}
                {reference('responsibleEmployee', employee, onEmployeeChange, 280)}
                {reference('rate', installment.rate ?? null, undefined, 240)}
            </Flex>
            <Flex gap="large" wrap align="flex-end">
                <Labelled title={editing ? 'Сумма до изменения' : 'Сумма'}><FieldDisplay field={money} value={installment.amount} /></Labelled>
                {editing && <Labelled title="Новая сумма">{amountInput ?? <FieldDisplay field={money} value={amount} />}</Labelled>}
                {editing && <Labelled title="Изменение">{difference}</Labelled>}
                <Labelled title="Внесено"><FieldDisplay field={money} value={paid} /></Labelled>
                <Labelled title="Остаток"><FieldDisplay field={money} value={amount - paid} /></Labelled>
            </Flex>
            {payments}
            {children}
        </Flex>
    </section>;
}

interface InstallmentPaymentsProperties {
    readonly part: FormTablePart;
    readonly payments: ReadonlyArray<InstallmentPayment>;
    readonly disabled: boolean;
    readonly register?: (form: FormInstance) => () => void;
    readonly onChange?: (payments: ReadonlyArray<InstallmentPayment>) => void;
}

/**
 * У каждой рассрочки своя форма таблицы, без вложенного HTML form: строки не принадлежат продаже.
 * В просмотре таблица недоступна для изменения. Новая версия данных задаётся ключом компонента.
 */
export function InstallmentPayments({ part, payments, disabled, register, onChange }: InstallmentPaymentsProperties) {
    const [form] = Form.useForm<FormValues>();
    const callbacks = useRef({ register, onChange });
    callbacks.current = { register, onChange };
    useEffect(() => callbacks.current.register?.(form), [form]);
    const rows: unknown = Form.useWatch('payments', { form, preserve: true });
    const reported = useRef(false);
    useEffect(() => {
        if (!Array.isArray(rows)) return;
        if (!reported.current) { reported.current = true; return; }
        callbacks.current.onChange?.(rows as ReadonlyArray<InstallmentPayment>);
    }, [rows]);
    return <Form form={form} component={false} disabled={disabled} initialValues={{ payments }}>
        <div style={{ maxWidth: 960 }}><TablePart part={part} showTitle={false} disabled={disabled} hiddenColumns={['shift']} columnWidths={{ date: 190, method: 160, amount: 150 }} addTitle="Добавить взнос" /></div>
    </Form>;
}
