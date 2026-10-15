import { App, Flex, Space, Typography } from 'antd';
import { FieldDisplay, fieldInput, FluidField, newRowValues, useFormData, useFormValue, type InputProperties } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { PaymentMethodInput } from './payment-method-input';

/**
 * Поле «Способ оплаты» продажи: кнопки со значками «Наличные», «Безналичные» и «Сложная».
 * Вместе со способом оно приводит строки оплат к выбранному способу, поэтому стоит на месте
 * стандартного поля ввода.
 *
 * Простым считается способ, который есть среди способов строки оплаты: «Наличные» или
 * «Безналичные». При простом способе у продажи одна оплата с этим способом. Смена одного простого
 * способа другим меняет способ в строке и сохраняет сумму, которую продавец мог ввести сам.
 * Переход от сложной оплаты оставляет одну строку с суммой продажи; если строк было несколько,
 * сначала спрашивается подтверждение, потому что их суммы и приёмники теряются. Приёмник
 * единственной строки сохраняется.
 *
 * Переход от простого способа к сложной оплате оставляет одну пустую строку: какую часть внести
 * каким способом, решает продавец, и подставленная сумма продажи ему бы мешала. Остаток
 * подставляется в строки, которые продавец добавляет после первой (элемент `SalePayments`).
 *
 * Справа от кнопок поле показывает состояние оплаты: сколько осталось оплатить, на сколько оплаты
 * превышают сумму продажи или что продажа оплачена. Состояние стоит рядом со способом, потому
 * что продавец смотрит на них вместе, выбирая, чем принять оставшуюся сумму.
 *
 * В fluid-компоновке название поля стоит в сегменте перед кнопками.
 */
function SalePaymentMode({ field, value, onChange, disabled, id, ref, fluid }: InputProperties<string> & { readonly fluid?: { readonly label: string; readonly required: boolean } }) {
    const sales = Objects.document.sale;
    const form = useFormData(sales);
    const amount = useFormValue(sales, 'amount') ?? 0;
    const payments = useFormValue(sales, 'payments');
    const { modal } = App.useApp();
    const part = form.view.tableParts.find((candidate) => candidate.name === 'payments');
    const methods = part?.columns.find((column) => column.name === 'method')?.choices ?? [];

    const change = (mode: string | null) => {
        const wasSimple = value != null && methods.includes(value);
        if (part === undefined || mode === null || !methods.includes(mode)) {
            onChange?.(mode);
            // Строка простой оплаты хранит способ и сумму продажи; сложная начинается с пустой строки.
            // Её не проверяют сразу: ошибки «Заполните поле» появились бы раньше, чем продавец начал ввод.
            if (part !== undefined && mode !== null && wasSimple) form.setValue('payments', [{ ...newRowValues(part), method: null, amount: null, receiver: null }], { validate: false });
            return;
        }
        const apply = () => {
            onChange?.(mode);
            // Строки вычисляются от текущего значения формы, а не от значения прошлой отрисовки.
            form.setValue('payments', (current) => {
                if (wasSimple && current.length <= 1) return current.map((payment) => ({ ...payment, method: mode }));
                // У продажи с нулевой суммой оплаты нет: сумма оплаты больше нуля.
                if (amount <= 0) return [];
                const receiver = current.length === 1 ? current[0]?.receiver ?? null : null;
                return [{ ...newRowValues(part), method: mode, amount, receiver }] as typeof current;
            });
        };
        if (payments.length <= 1) return apply();
        modal.confirm({
            closable: true,
            title: `Заменить оплаты одной оплатой «${mode}»?`,
            content: `Сейчас оплат ${payments.length}. Останется одна на сумму продажи, остальные суммы и значения «Куда оплачено» будут удалены.`,
            okText: 'Заменить',
            cancelText: 'Оставить сложную оплату',
            onOk: apply,
        });
    };
    const input = <PaymentMethodInput field={field} value={value} disabled={disabled} id={id} ref={ref} onChange={(entered) => change(typeof entered === 'string' ? entered : null)} />;
    return (
        <Flex align="center" gap="middle" wrap>
            {fluid === undefined ? input : (
                <FluidField label={fluid.label} required={fluid.required} block={false}>
                    {/* Переключатель не элемент ввода Ant Design: рамку, общую с сегментом названия, ему даёт сегмент. */}
                    <Space.Addon style={{ padding: 2 }}>{input}</Space.Addon>
                </FluidField>
            )}
            <PaymentState saleAmount={amount} payments={payments} />
        </Flex>
    );
}

export default fieldInput<string>({
    stacked: (properties) => <SalePaymentMode {...properties} />,
    fluid: ({ label, required, ...properties }) => <SalePaymentMode {...properties} fluid={{ label, required }} />,
});

/**
 * Способ строки оплаты, при котором деньги не приняты: на сумму оформляется рассрочка по продаже.
 * Совпадает с `installmentMethod` из `payments.ts`; константа оттуда не импортируется, потому что
 * это серверный модуль, а компонент собирается в клиент.
 */
const installmentMethod = 'Рассрочка';

/** Значение суммы для показа: формат денег тот же, что у полей формы. */
const money = { kind: 'money', target: null } as const;

/** Свойства состояния оплаты. */
interface PaymentStateProperties {
    readonly saleAmount: number;
    readonly payments: ReadonlyArray<{ readonly method: string | null; readonly amount: number | null }>;
}

/**
 * Состояние оплаты: сколько осталось оплатить, на сколько оплаты превышают сумму продажи или
 * что продажа оплачена. Если часть суммы закрыта способом «Рассрочка», продажа оплачена
 * с рассрочкой: деньги по этой части придут взносами. Продажу без суммы оплачивать нечем,
 * и состояния нет.
 */
function PaymentState({ saleAmount, payments }: PaymentStateProperties) {
    const paid = payments.reduce((total, payment) => total + (payment.amount ?? 0), 0);
    const remaining = saleAmount - paid;
    if (saleAmount <= 0 && remaining === 0) return null;
    if (remaining > 0) return <Typography.Text type="warning">Осталось оплатить: <FieldDisplay field={money} value={remaining} /></Typography.Text>;
    if (remaining < 0) return <Typography.Text type="danger">Оплаты больше суммы продажи на <FieldDisplay field={money} value={-remaining} /></Typography.Text>;
    const withInstallment = payments.some((payment) => payment.method === installmentMethod && (payment.amount ?? 0) > 0);
    return <Typography.Text type="success">{withInstallment ? 'Оплачено с рассрочкой' : 'Оплачено полностью'}</Typography.Text>;
}
