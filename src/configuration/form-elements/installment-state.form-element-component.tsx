import { Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { ActionDialog, FieldDisplay, useFormData, useFormRestrictions } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Состояние рассрочки на её форме и кнопки «Внести» и «Закрыть».
 *
 * Элемент управляет формой. Взносы недоступны для изменения: взнос добавляет действие «Внести».
 * Закрытую рассрочку нельзя изменить, пометить на удаление, пополнить и закрыть повторно:
 * политика рассрочки это отклоняет, и кнопки вели бы к отказу сервера.
 *
 * Стандартные кнопки обоих действий скрыты, а элемент выводит свои. Действия принимают рассрочку
 * во входных данных, и стандартное окно потребовало бы выбрать её вручную; элемент передаёт `guid`
 * открытой записи сам, а в окне взноса оставляет дату, сумму и получателя. Действие выполняет
 * форма: перед ним она записывает несохранённые изменения, после него показывает рассрочку
 * в новом состоянии. Кнопки, на действие которой у пользователя нет права, нет.
 *
 * Условие берётся из записанного состояния: рассрочка становится закрытой после ответа сервера.
 */
export default function InstallmentState() {
    const installments = Objects.document.installment;
    const form = useFormData(installments);
    const [paying, setPaying] = useState(false);
    const [closing, setClosing] = useState(false);
    const saved = form.saved;
    const closed = (saved?.closedAt ?? null) !== null;
    useFormRestrictions(installments, closed
        ? { readOnly: true, hiddenActions: ['pay', 'close', 'markDeleted'] }
        : { readOnlyFields: ['payments'], hiddenActions: ['pay', 'close'] });
    // У новой рассрочки состояния ещё нет, а действиям нужен `guid` записанной.
    if (saved === null) return null;

    const pay = form.view.actions.find((action) => action.name === 'pay');
    const close = form.view.actions.find((action) => action.name === 'close');
    const closeInstallment = async () => {
        setClosing(true);
        try {
            await form.runAction('close', { installment: saved.guid });
        } catch {
            // Об отказе уже сообщило уведомление с текстом сервера.
        } finally {
            setClosing(false);
        }
    };
    return (
        <Flex align="center" gap="middle" wrap>
            <Typography.Text strong>
                {closed ? <>Закрыта <FieldDisplay field={{ kind: 'dateTime', target: null }} value={saved.closedAt} /></> : 'Открыта'}
            </Typography.Text>
            {!closed && pay !== undefined && <Button onClick={() => setPaying(true)}>{pay.title}</Button>}
            {!closed && close !== undefined && <Button loading={closing} onClick={() => void closeInstallment()}>{close.title}</Button>}
            {paying && pay !== undefined && (
                <ActionDialog
                    action={{ ...pay, input: pay.input.filter((field) => field.name !== 'installment') }}
                    onExecute={async (input) => {
                        await form.runAction('pay', { ...input, installment: saved.guid });
                    }}
                    onClose={() => setPaying(false)}
                />
            )}
        </Flex>
    );
}
