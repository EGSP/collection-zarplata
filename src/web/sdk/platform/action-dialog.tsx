import { FieldLabel, isEmptyFieldValue } from '../derivations/field-label';
import { InputDraftItem } from '../../widgets/input-draft';
import { ComputedValues } from './computed-values';
import { TablePart } from './table-part';
import { useFieldTraversal, fieldAttribute } from './field-traversal';
import { Alert, Button, Form, Modal } from 'antd';
import { Pending } from '../../common/pending';
import { BreakpointContainer } from '../ds/breakpoints';
import { useEffect, useState, type ComponentType } from 'react';
import type { FormAction, FormField } from '../../../server/ui/descriptions';
import { ApiError } from '../../common/api';
import { FieldDisplay, FieldInput } from '../../widgets/registry';
import { fieldRules, formFieldPaths, isMarkedRequired, serverRejectionMessage } from '../../widgets/validation';
import { newInputValues, requestFieldDefaults, type FormValues } from './record-values';
import type { DateLimits, InputProperties } from '../../widgets/widget';

/** Свойства окна входных данных действия. */
export interface ActionDialogProperties {
    /** Замены отдельных полей ввода, как columnInputs у TablePart. Проверки и раскладку ведёт окно. */
    readonly fieldInputs?: Readonly<Record<string, ComponentType<InputProperties<unknown>>>>;
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
    /**
     * Начальные значения полей поверх значений по умолчанию: например, окно открыто для изменения
     * уже применённого значения. Окно читает их только при открытии.
     */
    readonly initialValues?: FormValues | undefined;
}

/**
 * Окно входных данных собственного действия. Поля берутся из того же реестра виджетов
 * и проверяются по тем же правилам, что поля формы записи. Если сервер отклонил входные данные,
 * поля из его перечня отмечаются ошибкой. На время запроса закрытие блокируется, чтобы ответ
 * сервера и ошибки полей пришли в открытое окно.
 */
export function ActionDialog({ action, dateLimits, fieldInputs, onExecute, onClose, initialValues }: ActionDialogProperties) {
    const [form] = Form.useForm<FormValues>();
    const [executing, setExecuting] = useState(false);
    const parts = action.tableParts ?? [];
    const [opening] = useState(() => ({
        fields: action.input,
        source: action.defaultsSource,
        given: initialValues,
        values: { ...newInputValues(action.input), ...Object.fromEntries(parts.map(part => [part.name, []])) },
    }));
    const [attempt, setAttempt] = useState(0);
    const [defaults, setDefaults] = useState<FormValues | Error | null>(() =>
        opening.source !== undefined && opening.fields.some(field => field.serverDefault && !Object.hasOwn(opening.given ?? {}, field.name))
            ? null
            : { ...opening.values, ...opening.given });
    const ready = defaults !== null && !(defaults instanceof Error);
    const traversal = useFieldTraversal([...action.input.filter(field => !field.readOnly).map(field => field.name), ...parts.map(part => part.name)], ready && !executing);

    useEffect(() => {
        let active = true;
        // Запрашиваем сервер только для эффектов и только после проверочного монтирования Strict Mode.
        queueMicrotask(() => {
            if (!active) return;
            void requestFieldDefaults(opening.fields, opening.source, opening.given)?.then(
                values => { if (active) setDefaults({ ...opening.values, ...values, ...opening.given }); },
                error => { if (active) setDefaults(error instanceof Error ? error : new Error('Не удалось загрузить начальные значения')); },
            );
        });
        return () => { active = false; };
    }, [opening, attempt]);

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
            okButtonProps={{ disabled: !ready }}
            onOk={() => form.submit()}
            onCancel={() => {
                if (!executing) onClose();
            }}
        >
            {/* Окно ведёт собственный ввод: недоступность формы продажи не должна наследоваться
                его полями. Во время выполнения запроса блокируется уже сам ввод окна. */}
            {defaults === null ? <Pending label="Загружаем начальные значения" /> : defaults instanceof Error ?
                <Alert type="error" title={defaults.message} action={
                    <Button onClick={() => { setDefaults(null); setAttempt(attempt + 1); }}>Повторить</Button>
                } /> : <BreakpointContainer of="fixed" point="sm">
            <Form form={form} scrollToFirstError={{ focus: true }} disabled={executing} layout="vertical" initialValues={defaults} onKeyDownCapture={traversal.onKeyDownCapture} onFinish={(input) => void execute(input)}>
                <ComputedValues view={{ fields: action.input, tableParts: parts }} />
                {action.input.map((field) => {
                    const limits = field.kind === 'date' ? dateLimits?.[field.name] : undefined;
                    const Input = fieldInputs?.[field.name] ?? FieldInput;
                    return (
                        <InputDraftItem {...{ [fieldAttribute]: field.name }} key={field.name} name={field.name} label={<ActionFieldLabel field={field} />} required={isMarkedRequired(field)} rules={[
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
                            {field.readOnly ? <FieldDisplay field={field} /> : <Input field={field} dateLimits={limits} ref={traversal.register(field.name)} />}
                        </InputDraftItem>
                    );
                })}
                {parts.map((part) => <div key={part.name} {...{ [fieldAttribute]: part.name }}><TablePart part={part} ref={traversal.register(part.name)} onPrevious={() => traversal.previous(part.name)} disabled={executing} /></div>)}
            </Form>
            </BreakpointContainer>}
        </Modal>
    );
}

/** Название входного поля действия следит за его значением, как название в FieldGroup. */
function ActionFieldLabel({ field }: { readonly field: FormField }) {
    const value: unknown = Form.useWatch(field.name, { preserve: true });
    return <FieldLabel empty={isEmptyFieldValue(value)} readOnly={field.readOnly}>{field.title}</FieldLabel>;
}
