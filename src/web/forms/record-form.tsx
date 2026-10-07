import { useHotkey } from '@tanstack/react-hotkeys';
import { useCreate, useUpdate } from '@refinedev/core';
import { Button, Card, Flex, Form, Tag, theme, Typography } from 'antd';
import { useEffect, useRef, useState } from 'react';
import type { FormAction, FormField, FormGroup, FormView, ObjectView } from '../../server/ui/descriptions';
import { ApiError } from '../common/api';
import { recordPath } from '../common/paths';
import { useAction, useInvalidateData } from '../data-provider/actions';
import { resourceName } from '../data-provider/perform';
import { recordGuid, type RecordData } from '../data-provider/records';
import { recordPresentation, recordTitle } from '../references/presentation';
import { useTabTitle, useUnsavedChanges, useWindowTab } from '../tabs/window-tabs';
import { FieldDisplay, FieldInput } from '../widgets/registry';
import { fieldRules, formFieldPaths, isMarkedRequired, serverRejectionMessage } from '../widgets/validation';
import { ActionDialog } from './action-dialog';
import { useFieldFocus, type FieldFocus } from './field-focus';
import { hasOpenDialog, hasOpenPicker } from './keyboard';
import { newRecordValues, recordValues, saveFields, type FormValues } from './record-values';
import { TablePart } from './table-part';

/** Заголовки уведомлений об успехе стандартных действий. У собственного действия заголовком служит его название. */
const successMessages: { readonly [action: string]: string } = {
    post: 'Документ проведён',
    unpost: 'Проведение отменено',
    markDeleted: 'Запись помечена на удаление',
    unmarkDeleted: 'Пометка удаления снята',
};

interface RecordFormProperties {
    readonly object: ObjectView;
    readonly view: FormView;
    /** Запись, с которой открыта форма. У формы новой записи `null`. */
    readonly record: RecordData | null;
    /**
     * Читает запись с сервера заново. Нужна после собственного действия: оно могло изменить запись,
     * а в ответе её не возвращает. У формы новой записи `null`: читать ещё нечего.
     */
    readonly reload: (() => Promise<RecordData>) | null;
}

/**
 * Форма записи справочника или документа по описанию формы с сервера.
 *
 * Значения и ошибки полей хранит форма Ant Design, а запись выполняют хуки данных Refine.
 * Отдельно форма помнит записанное состояние: запись в том виде, в каком её последним вернул
 * сервер. По нему выводятся заголовок, отметки и поля только для чтения, к нему применяются
 * действия, и из него берутся значения полей, которых на форме нет.
 *
 * Все действия, кроме «Записать», применяются к записанному состоянию. Поэтому при несохранённых
 * изменениях форма сначала записывает их отдельным запросом и только затем выполняет действие.
 * Объединить запросы в один пакет нельзя: у новой записи до ответа на запись нет `guid`,
 * который нужен действию. Если действие после успешной записи отклонено, запись остаётся
 * сохранённой, и форма показывает её сохранённое состояние.
 *
 * Форма без действия `save` в описании открывается только для просмотра.
 *
 * Форма показана во вкладке и остаётся смонтированной, пока вкладка скрыта. Кнопка «Закрыть»
 * и Esc закрывают вкладку; подтверждение при несохранённых изменениях спрашивает вкладка.
 */
export function RecordForm({ object, view, record, reload }: RecordFormProperties) {
    const [form] = Form.useForm<FormValues>();
    const tab = useWindowTab();
    const resource = resourceName(object);

    const [saved, setSaved] = useState(record);
    // Начальные значения вычисляются один раз: у новой записи в них входит текущее время.
    const [initialValues] = useState(() => (record === null ? newRecordValues(view) : recordValues(view, record)));
    /** Имя действия, которое сейчас выполняется: на это время кнопки действий недоступны. */
    const [running, setRunning] = useState<string | null>(null);
    /** Собственное действие, для которого открыто окно входных данных. */
    const [dialogAction, setDialogAction] = useState<FormAction | null>(null);

    const changed = useRef(false);
    const executing = useRef(false);
    // Виджет может закрыть выбор до глобального обработчика Escape. Сохраняем состояние до события.
    const pickerEvents = useRef(new WeakSet<KeyboardEvent>());
    useUnsavedChanges(changed);
    useTabTitle(saved === null ? `${object.title} (новый)` : recordPresentation(object, saved));

    const { mutateAsync: create } = useCreate<RecordData, ApiError, FormValues>();
    const { mutateAsync: update } = useUpdate<RecordData, ApiError, FormValues>();
    const performAction = useAction();
    const invalidateData = useInvalidateData();

    const editable = view.actions.some((action) => action.name === 'save');

    const focus = useFieldFocus();
    useEffect(() => {
        // В новой записи пользователь сразу начинает ввод с первого поля порядка обхода.
        if (record === null) view.traversal.some((name) => focus.focus(name));
        // Фокус ставится один раз при открытии формы.
    }, []);

    /** Показывает запись, которую вернул сервер: она становится записанным состоянием формы. */
    const show = (next: RecordData) => {
        setSaved(next);
        form.setFieldsValue(recordValues(view, next));
        // Ошибки сервера относились к прежним значениям и сами при замене значений не исчезают.
        form.setFields(
            form
                .getFieldsError()
                .filter((field) => field.errors.length > 0)
                .map((field) => ({ name: field.name, errors: [] })),
        );
        changed.current = false;
    };

    /**
     * Проверяет и записывает форму. Возвращает запись от сервера либо `null`, если запись
     * не состоялась: тогда ошибки уже показаны под полями и в уведомлении, а введённые значения
     * остаются на форме.
     */
    const save = async (): Promise<RecordData | null> => {
        let entered: FormValues;
        try {
            entered = await form.validateFields();
        } catch {
            const first = form.getFieldsError().find((field) => field.errors.length > 0);
            if (first !== undefined) form.scrollToField(first.name, { focus: true, block: 'center' });
            return null;
        }
        const fields = saveFields(view, saved, entered);
        try {
            const response = saved === null ? await create({ resource, values: fields }) : await update({ resource, id: recordGuid(saved), values: fields });
            void invalidateData();
            return response.data;
        } catch (error) {
            // Текст сервера показало уведомление. Отдельного текста на каждое поле у сервера нет,
            // поэтому поля из его перечня только отмечаются.
            if (error instanceof ApiError && error.statusCode === 400) {
                form.setFields(formFieldPaths(error.fields, 'payload.fields.').map((name) => ({ name, errors: [serverRejectionMessage] })));
            }
            return null;
        }
    };

    /**
     * Выполняет действие формы. `input` содержит входные данные собственного действия.
     * При `closeAfter` закрывает форму после успешного действия; при ошибке оставляет её открытой.
     * Возвращает `null` при успехе либо ошибку, из-за которой действие не выполнено.
     */
    const run = async (action: FormAction, input: FormValues | null, closeAfter = false): Promise<unknown> => {
        // Состояние React обновится позже; ссылка блокирует повторное нажатие в том же кадре.
        if (executing.current) return new Error('Действие уже выполняется');
        executing.current = true;
        let completed = false;
        const isSave = action.standard && action.name === 'save';
        let current = saved;
        setRunning(action.name);
        try {
            if (isSave || current === null || changed.current) {
                current = await save();
                if (current === null) return new Error('Запись не сохранена');
                show(current);
                if (isSave) return null;
            }
            if (action.standard) {
                // Стандартное действие возвращает обновлённую запись, и повторно читать её не нужно.
                current = await performAction<RecordData>({
                    resource,
                    action: action.name,
                    payload: { guid: recordGuid(current) },
                    successMessage: successMessages[action.name] ?? action.title,
                });
                show(current);
            } else {
                await performAction({ resource, action: action.name, payload: input ?? {}, successMessage: action.title });
                if (reload !== null) show(await reload());
            }
            completed = true;
            return null;
        } catch (error) {
            return error;
        } finally {
            executing.current = false;
            setRunning(null);
            // У созданной записи появился собственный адрес: вкладка переходит на него, и повторное
            // открытие этой записи находит эту же вкладку.
            if (completed && closeAfter) tab.close();
            else if (saved === null && current !== null) tab.relocate(recordPath(object, recordGuid(current)));
        }
    };

    const isVisible = (action: FormAction): boolean => {
        // Собственное действие выполняется над записанной записью и после него запись читается заново.
        if (!action.standard) return saved !== null && reload !== null;
        switch (action.name) {
            case 'save':
                return true;
            // Провести можно и проведённый документ: повторное проведение переписывает движения.
            // Новую запись перед проведением нужно записать, поэтому без права записи провести её нельзя.
            case 'post':
                return saved !== null || editable;
            case 'unpost':
                return saved?.['posted'] === true;
            case 'markDeleted':
                return saved !== null && saved['deletedAt'] === null;
            case 'unmarkDeleted':
                return saved !== null && saved['deletedAt'] !== null;
            default:
                return saved !== null;
        }
    };

    const keyboardAction = (name: string, closeAfter = false) => {
        if (hasOpenDialog() || executing.current) return;
        const action = view.actions.find((candidate) => candidate.standard && candidate.name === name && isVisible(candidate));
        if (action !== undefined) void run(action, null, closeAfter);
    };
    // Форма скрытой вкладки остаётся смонтированной: без этого условия сочетание сработало бы на всех открытых формах.
    const hotkeyOptions = { ignoreInputs: false, requireReset: true, enabled: tab.active };
    useHotkey('Control+S', (event) => {
        if (!event.isComposing) keyboardAction('save');
    }, hotkeyOptions);
    useHotkey('Control+Enter', (event) => {
        if (!event.isComposing) keyboardAction('post', true);
    }, hotkeyOptions);
    // Ant Design обрабатывает Esc на window: событие должно дойти туда и закрыть верхнее окно.
    useHotkey('Escape', (event) => {
        if (!event.isComposing && !hasOpenDialog() && !pickerEvents.current.has(event) && !executing.current) tab.close();
    }, { ...hotkeyOptions, preventDefault: false, stopPropagation: false });

    const move = (name: string, direction: number) => {
        for (let index = view.traversal.indexOf(name) + direction; index >= 0 && index < view.traversal.length; index += direction) {
            const next = view.traversal[index];
            if (next !== undefined && focus.focus(next)) break;
        }
    };

    return (
        <Flex vertical gap="middle" onKeyDownCapture={(event) => {
            if (event.key === 'Escape' && hasOpenPicker(event.target)) pickerEvents.current.add(event.nativeEvent);
            if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.nativeEvent.isComposing || !editable || hasOpenDialog() || hasOpenPicker(event.target)) return;
            const target = event.target;
            if (!(target instanceof HTMLElement) || target.closest('[data-table-part], button, a') !== null) return;
            const name = target.closest<HTMLElement>('[data-form-field]')?.dataset['formField'];
            if (name === undefined) return;
            event.preventDefault();
            event.stopPropagation();
            if (!event.repeat) move(name, event.shiftKey ? -1 : 1);
        }}>
            <Flex justify="space-between" align="flex-start" gap="middle" wrap>
                <Flex vertical gap="small">
                    <Typography.Title level={3} style={{ margin: 0 }}>
                        {recordTitle(object, saved)}
                    </Typography.Title>
                    <Flex>
                        {saved !== null && saved['deletedAt'] !== null && <Tag color="error">Помечен на удаление</Tag>}
                        {saved?.['posted'] === true && <Tag color="success">Проведён</Tag>}
                    </Flex>
                </Flex>
                <Flex gap="small" wrap>
                    {view.actions.filter(isVisible).map((action) => (
                        <Button
                            key={action.name}
                            type={action.standard && action.name === 'save' ? 'primary' : 'default'}
                            loading={running === action.name}
                            disabled={running !== null}
                            onClick={() => (action.input.length > 0 ? setDialogAction(action) : void run(action, null))}
                        >
                            {action.title}
                        </Button>
                    ))}
                    <Button onClick={tab.close}>Закрыть</Button>
                </Flex>
            </Flex>
            <Form
                form={form}
                layout="vertical"
                disabled={!editable}
                initialValues={initialValues}
                onValuesChange={() => {
                    changed.current = true;
                }}
            >
                <Flex vertical gap="middle">
                    {view.groups.map((group, index) => (
                        <Group key={index} group={group} view={view} saved={saved} editable={editable} focus={focus} onPrevious={(name) => move(name, -1)} />
                    ))}
                </Flex>
            </Form>
            {dialogAction !== null && <ActionDialog action={dialogAction} onExecute={(input) => run(dialogAction, input)} onClose={() => setDialogAction(null)} />}
        </Flex>
    );
}

interface GroupProperties {
    readonly group: FormGroup;
    readonly view: FormView;
    readonly saved: RecordData | null;
    readonly editable: boolean;
    readonly focus: FieldFocus;
    readonly onPrevious: (name: string) => void;
}

/**
 * Группа элементов формы. Поля шапки стоят в несколько колонок, табличная часть занимает всю
 * ширину формы. Группа с заголовком выводится блоком с заголовком, группа без заголовка без рамки.
 */
function Group({ group, view, saved, editable, focus, onPrevious }: GroupProperties) {
    const { token } = theme.useToken();
    const elements = (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', columnGap: token.marginLG }}>
            {group.elements.map((name) => {
                const field = view.fields.find((candidate) => candidate.name === name);
                if (field !== undefined) return <HeaderField key={name} field={field} saved={saved} focus={focus} />;
                const part = view.tableParts.find((candidate) => candidate.name === name);
                if (part === undefined) return null;
                return (
                    <div key={name} style={{ gridColumn: '1 / -1', marginBottom: token.marginLG }}>
                        <TablePart part={part} disabled={!editable} ref={focus.register(name)} onPrevious={() => onPrevious(name)} />
                    </div>
                );
            })}
        </div>
    );
    if (group.title === null) return elements;
    return (
        <Card size="small" title={group.title}>
            {elements}
        </Card>
    );
}

/**
 * Поле шапки формы. Поле только для чтения заполняет платформа: оно показывает значение
 * из записанного состояния и в значения формы не входит. У новой записи оно пусто.
 */
function HeaderField({ field, saved, focus }: { readonly field: FormField; readonly saved: RecordData | null; readonly focus: FieldFocus }) {
    const { token } = theme.useToken();
    if (field.readOnly) {
        return (
            <Form.Item label={field.title}>
                <Flex align="center" style={{ minHeight: token.controlHeight }}>
                    <FieldDisplay field={field} value={saved?.[field.name]} />
                </Flex>
            </Form.Item>
        );
    }
    return (
        <div data-form-field={field.name}>
            <Form.Item name={field.name} label={field.title} required={isMarkedRequired(field)} rules={fieldRules(field)}>
                <FieldInput field={field} ref={focus.register(field.name)} />
            </Form.Item>
        </div>
    );
}
