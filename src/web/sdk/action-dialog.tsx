import { Form, Modal } from 'antd';
import { useState } from 'react';
import type { FormAction } from '../../server/ui/descriptions';
import { ApiError } from '../common/api';
import { FieldInput } from '../widgets/registry';
import { fieldRules, formFieldPaths, isMarkedRequired, serverRejectionMessage } from '../widgets/validation';
import type { FormValues } from './record-values';

/** Свойства окна входных данных действия. */
export interface ActionDialogProperties {
    /** Собственное действие с входными данными. */
    readonly action: FormAction;
    /**
     * Выполняет действие с введёнными данными. Если вызов завершился ошибкой, действие
     * не выполнено: окно остаётся открытым, а введённые данные сохраняются.
     */
    readonly onExecute: (input: FormValues) => Promise<void>;
    readonly onClose: () => void;
}

/**
 * Окно входных данных собственного действия. Поля берутся из того же реестра виджетов
 * и проверяются по тем же правилам, что поля формы записи. Если сервер отклонил входные данные,
 * поля из его перечня отмечаются ошибкой. На время запроса закрытие блокируется, чтобы ответ
 * сервера и ошибки полей пришли в открытое окно.
 */
export function ActionDialog({ action, onExecute, onClose }: ActionDialogProperties) {
    const [form] = Form.useForm<FormValues>();
    const [executing, setExecuting] = useState(false);

    const execute = async (input: FormValues) => {
        setExecuting(true);
        try {
            await onExecute(input);
        } catch (error) {
            setExecuting(false);
            if (error instanceof ApiError && error.statusCode === 400) {
                // Входные данные действия лежат прямо в `payload`, без вложенного `fields`.
                form.setFields(formFieldPaths(error.fields, 'payload.').map((name) => ({ name, errors: [serverRejectionMessage] })));
            }
            return;
        }
        onClose();
    };

    return (
        <Modal
            open
            title={action.title}
            okText="Выполнить"
            cancelText="Отмена"
            confirmLoading={executing}
            closable={{ disabled: executing }}
            keyboard={!executing}
            cancelButtonProps={{ disabled: executing }}
            onOk={() => form.submit()}
            onCancel={() => {
                if (!executing) onClose();
            }}
        >
            <Form form={form} layout="vertical" initialValues={Object.fromEntries(action.input.map((field) => [field.name, null]))} onFinish={(input) => void execute(input)}>
                {action.input.map((field) => (
                    <Form.Item key={field.name} name={field.name} label={field.title} required={isMarkedRequired(field)} rules={fieldRules(field)}>
                        <FieldInput field={field} />
                    </Form.Item>
                ))}
            </Form>
        </Modal>
    );
}
