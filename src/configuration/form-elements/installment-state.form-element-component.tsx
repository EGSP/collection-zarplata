import { Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { ActionDialog, FieldDisplay, useFormData, useFormRestrictions } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Дата последнего взноса; без взносов `null`. Так же её считает сервер при проверке даты закрытия.
 * Строки дат хранятся с часовым поясом клиента, поэтому сравниваются моменты, а не строки.
 */
function lastPaymentDate(payments: ReadonlyArray<{ readonly date: string }>): string | null {
    return payments.reduce<string | null>((latest, payment) => latest === null || new Date(payment.date).getTime() > new Date(latest).getTime() ? payment.date : latest, null);
}

/**
 * Состояние рассрочки по продаже на её форме и кнопки «Внести» и «Закрыть».
 *
 * Элемент управляет формой. Взносы недоступны для изменения: взнос добавляет действие «Внести».
 * Закрытую рассрочку нельзя изменить, пометить на удаление, пополнить и закрыть повторно:
 * политика рассрочки это отклоняет, и кнопки вели бы к отказу сервера.
 * Проведение и его отмена на закрытой форме также скрыты: она служит только для просмотра.
 * У непроведённой рассрочки кнопок «Внести» и «Закрыть» нет: оба действия её отклоняют.
 *
 * Стандартные кнопки обоих действий скрыты, а элемент выводит свои. Действия принимают рассрочку
 * во входных данных, и стандартное окно потребовало бы выбрать её вручную; элемент передаёт `guid`
 * открытой записи сам, а в окне взноса оставляет дату, способ, сумму и «Куда оплачено».
 * Окно закрытия спрашивает только дату и предлагает дату последнего взноса: собственная рассрочка
 * начисляется в зарплату периодом закрытия, а погашена она в день последнего взноса.
 * Действие выполняет форма: перед ним она записывает несохранённые изменения, после него показывает рассрочку
 * в новом состоянии. Кнопки, на действие которой у пользователя нет права, нет.
 *
 * Условие берётся из записанного состояния: рассрочка становится закрытой после ответа сервера.
 */
export default function InstallmentState() {
    const installments = Objects.document.saleInstallment;
    const form = useFormData(installments);
    const [paying, setPaying] = useState(false);
    const [closing, setClosing] = useState(false);
    const saved = form.saved;
    const closed = (saved?.closedAt ?? null) !== null;
    const posted = saved?.posted === true;
    useFormRestrictions(installments, closed
        ? { readOnly: true, hiddenActions: ['pay', 'close', 'post', 'unpost', 'markDeleted'] }
        : { readOnlyFields: ['payments'], hiddenActions: ['pay', 'close'] });
    // У новой рассрочки состояния ещё нет, а действиям нужен `guid` записанной.
    if (saved === null) return null;

    const pay = form.view.actions.find((action) => action.name === 'pay');
    const close = form.view.actions.find((action) => action.name === 'close');
    // Без взносов подсказывать нечего: такую рассрочку политика не даст закрыть, потому что остаток не нулевой.
    const suggestedClosing = lastPaymentDate(saved.payments);
    return (
        <Flex align="center" gap="middle" wrap>
            <Typography.Text strong>
                {closed ? <>Закрыта <FieldDisplay field={{ kind: 'dateTime', target: null }} value={saved.closedAt} /></> : posted ? 'Открыта' : 'Не проведена'}
            </Typography.Text>
            {!closed && posted && pay !== undefined && <Button onClick={() => setPaying(true)}>{pay.title}</Button>}
            {!closed && posted && close !== undefined && <Button onClick={() => setClosing(true)}>{close.title}</Button>}
            {paying && pay !== undefined && (
                <ActionDialog
                    action={{ ...pay, input: pay.input.filter((field) => field.name !== 'installment') }}
                    onExecute={async (input) => {
                        await form.runAction('pay', { ...input, installment: saved.guid });
                    }}
                    onClose={() => setPaying(false)}
                />
            )}
            {closing && close !== undefined && (
                <ActionDialog
                    action={{ ...close, input: close.input.filter((field) => field.name !== 'installment').map((field) => field.name === 'closedAt' ? { ...field, initial: suggestedClosing } : field) }}
                    onExecute={async (input) => {
                        await form.runAction('close', { ...input, installment: saved.guid });
                    }}
                    onClose={() => setClosing(false)}
                />
            )}
        </Flex>
    );
}
