/** Частичная замена ввода приёмника в стандартном окне взноса. */
import { Form } from 'antd';
import { ActionDialog, FieldInput, type ActionDialogProperties, type InputProperties } from '../../web/sdk';
import { PaymentReceiverDefault } from '../form-elements/payment-receiver-default';

/** Компонент поля имеет постоянный тип, чтобы окно не пересоздавало ввод при смене способа. */
const fieldInputs = { receiver: PaymentReceiverInput };

/** Стандартное окно ведёт проверки, запрос и закрытие; конфигурация заменяет только одно поле. */
export function InstallmentPaymentDialog({ action, ...properties }: Pick<ActionDialogProperties, 'action' | 'onExecute' | 'onClose'>) {
    return <ActionDialog {...properties} action={{ ...action, input: action.input.filter((field) => field.name !== 'installment') }} fieldInputs={fieldInputs} />;
}

/** Обычный ввод составного значения, дополненный подстановкой по способу в этой же форме взноса. */
function PaymentReceiverInput(properties: InputProperties<unknown>) {
    const form = Form.useFormInstance();
    const method: unknown = Form.useWatch('method', { form, preserve: true });
    return <>
        <PaymentReceiverDefault method={typeof method === 'string' ? method : null} receiver={properties.value} initialize
            disabled={properties.disabled === true} onChange={(receiver) => form.setFieldValue('receiver', receiver)} />
        <FieldInput {...properties} />
    </>;
}
