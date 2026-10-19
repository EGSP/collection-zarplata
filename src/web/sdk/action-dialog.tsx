import { ComputedValues } from './computed-values';
import { TablePart } from './table-part';
import { useFieldTraversal, fieldAttribute } from './field-traversal';
import { Form, Modal } from 'antd';
import { useState } from 'react';
import type { FormAction } from '../../server/ui/descriptions';
import { ApiError } from '../common/api';
import { FieldDisplay, FieldInput } from '../widgets/registry';
import { fieldRules, formFieldPaths, isMarkedRequired, serverRejectionMessage } from '../widgets/validation';
import { newInputValues, type FormValues } from './record-values';
import type { DateLimits } from '../widgets/widget';

/** Свойства окна входных данных действия. */
export interface ActionDialogProperties {
    /** Собственное действие с входными данными. */
    readonly action: FormAction;
    /** Динамические включительные границы полей дат по имени; проверяются также перед отправкой формы. */
    readonly dateLimits?: Readonly<Record<string, DateLimits>> | undefined;
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
export function ActionDialog({ action, dateLimits, onExecute, onClose }: ActionDialogProperties) {
    const [form] = Form.useForm<FormValues>();
    const [executing, setExecuting] = useState(false);
    const parts = action.tableParts ?? [];
    const traversal = useFieldTraversal([...action.input.filter((field) => !field.readOnly).map((field) => field.name), ...parts.map((part) => part.name)], !executing);

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
            width={parts.length > 0 ? 1100 : 520}
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
            {/* Окно ведёт собственный ввод: недоступность формы продажи не должна наследоваться
                его полями. Во время выполнения запроса блокируется уже сам ввод окна. */}
            <Form form={form} disabled={executing} layout="vertical" initialValues={{ ...newInputValues(action.input), ...Object.fromEntries(parts.map((part) => [part.name, []])) }} onKeyDownCapture={traversal.onKeyDownCapture} onFinish={(input) => void execute(input)}>
                <ComputedValues view={{ fields: action.input, tableParts: parts }} />
                {action.input.map((field) => {
                    const limits = field.kind === 'date' ? dateLimits?.[field.name] : undefined;
                    return (
                        <Form.Item {...{ [fieldAttribute]: field.name }} key={field.name} name={field.name} label={field.title} required={isMarkedRequired(field)} rules={[
                            ...fieldRules(field),
                            // Проверка формы нужна и для прежнего значения: пока окно открыто,
                            // другое действие могло закрыть период и сдвинуть доступную границу.
                            ...limits === undefined ? [] : [{ validator: (_rule: unknown, value: unknown) => {
                                if (typeof value !== 'string') return Promise.resolve();
                                if (limits.minimum !== undefined && value < limits.minimum) return Promise.reject(new Error('Дата раньше начала доступного периода'));
                                if (limits.maximum !== undefined && value > limits.maximum) return Promise.reject(new Error('Дата позже конца доступного периода'));
                                return Promise.resolve();
                            } }],
                        ]}>
                            {field.readOnly ? <FieldDisplay field={field} /> : <FieldInput field={field} dateLimits={limits} ref={traversal.register(field.name)} />}
                        </Form.Item>
                    );
                })}
                {parts.map((part) => <div key={part.name} {...{ [fieldAttribute]: part.name }}><TablePart part={part} ref={traversal.register(part.name)} onPrevious={() => traversal.previous(part.name)} disabled={executing} /></div>)}
            </Form>
        </Modal>
    );
}
