import { App } from 'antd';
import { FieldInput, newRowValues, useFormData, useFormValue, type InputProperties } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Поле «Способ оплаты» продажи. Вместе со способом оно приводит строки оплат к выбранному способу,
 * поэтому стоит на месте стандартного поля ввода.
 *
 * Простым считается способ, который есть среди способов строки оплаты: «Наличные» или
 * «Безналичные». При простом способе у продажи одна оплата с этим способом. Смена одного простого
 * способа другим меняет способ в строке и сохраняет сумму, которую продавец мог ввести сам.
 * Переход от сложной оплаты оставляет одну строку с суммой продажи; если строк было несколько,
 * сначала спрашивается подтверждение, потому что их суммы и приёмники теряются. Приёмник
 * единственной строки сохраняется. Переход к сложной оплате строки не меняет.
 */
export default function SalePaymentMode({ field, value, onChange, disabled, id, ref }: InputProperties<string>) {
    const sales = Objects.document.sale;
    const form = useFormData(sales);
    const amount = useFormValue(sales, 'amount') ?? 0;
    const payments = useFormValue(sales, 'payments');
    const { modal } = App.useApp();
    const part = form.view.tableParts.find((candidate) => candidate.name === 'payments');
    const methods = part?.columns.find((column) => column.name === 'method')?.choices ?? [];

    const change = (mode: string | null) => {
        if (part === undefined || mode === null || !methods.includes(mode)) return onChange?.(mode);
        const wasSimple = value != null && methods.includes(value);
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
    return <FieldInput field={field} value={value} disabled={disabled} id={id} ref={ref} onChange={(entered) => change(typeof entered === 'string' ? entered : null)} />;
}
