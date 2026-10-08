import { useHotkey } from '@tanstack/react-hotkeys';
import { Button, Flex, Form, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
    ActionButton,
    actionApplies,
    actionSuccessMessage,
    ApiError,
    FieldGroup,
    formFieldPaths,
    hasOpenDialog,
    hasOpenPicker,
    newRecordValues,
    Page,
    recordGuid,
    recordPath,
    recordPresentation,
    recordTitle,
    recordValues,
    saveFields,
    serverRejectionMessage,
    useAction,
    useFieldTraversal,
    useUnsavedChanges,
    useWindowTab,
    type FormAction,
    type FormField,
    type FormTablePart,
    type FormValues,
    type FormView,
    type ObjectView,
    type RecordData,
} from '../sdk';

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
 * Форма записи справочника или документа по описанию формы с сервера. Собрана из web SDK
 * и служит образцом собственного экрана с формой.
 *
 * Значения и ошибки полей хранит форма Ant Design, а запись и действия выполняет хук действий SDK.
 * Отдельно форма помнит записанное состояние: запись в том виде, в каком её последним вернул
 * сервер. По нему выводятся заголовок, отметки и поля только для чтения, к нему применяются
 * действия, и из него берутся значения полей, которых на форме нет.
 *
 * Все действия, кроме «Записать», применяются к записанному состоянию. Поэтому при несохранённых
 * изменениях форма сначала записывает их отдельным запросом и только затем выполняет действие.
 * Объединить запросы в один пакет нельзя: у новой записи до ответа на запись нет `guid`,
 * который нужен действию. Если действие после успешной записи отклонено, запись остаётся
 * сохранённой, и форма показывает её сохранённое состояние. Из-за этого порядка кнопки действий
 * не выполняют действие сами: форма заменяет их выполнение своим.
 *
 * Форма без действия `save` в описании открывается только для просмотра.
 *
 * Форма показана во вкладке и остаётся смонтированной, пока вкладка скрыта. Кнопка «Закрыть»
 * и Esc закрывают вкладку; подтверждение при несохранённых изменениях спрашивает вкладка.
 */
export function RecordForm({ object, view, record, reload }: RecordFormProperties) {
    const [form] = Form.useForm<FormValues>();
    const tab = useWindowTab();

    const [saved, setSaved] = useState(record);
    // Начальные значения вычисляются один раз: у новой записи в них входит текущее время.
    const [initialValues] = useState(() => (record === null ? newRecordValues(view) : recordValues(view, record)));
    /** Имя действия, которое сейчас выполняется: на это время кнопки действий недоступны. */
    const [running, setRunning] = useState<string | null>(null);

    const changed = useRef(false);
    const executing = useRef(false);
    // Виджет может закрыть выбор до глобального обработчика Escape. Сохраняем состояние до события.
    const pickerEvents = useRef(new WeakSet<KeyboardEvent>());
    useUnsavedChanges(changed);

    const performAction = useAction();

    const editable = view.actions.some((action) => action.name === 'save');

    const traversal = useFieldTraversal(view.traversal, editable);
    useEffect(() => {
        // В новой записи пользователь сразу начинает ввод с первого поля порядка обхода.
        if (record === null) traversal.focusFirst();
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
            return await performAction<RecordData>({
                object,
                action: 'save',
                payload: saved === null ? { fields } : { guid: recordGuid(saved), fields },
                successMessage: saved === null ? 'Запись создана' : 'Запись сохранена',
                failureMessage: saved === null ? 'Не удалось создать запись' : 'Не удалось сохранить запись',
            });
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
     * Если действие не выполнено, вызов завершается ошибкой, из-за которой это произошло.
     */
    const run = async (action: FormAction, input: FormValues | null, closeAfter = false): Promise<void> => {
        // Состояние React обновится позже; ссылка блокирует повторное нажатие в том же кадре.
        if (executing.current) throw new Error('Действие уже выполняется');
        executing.current = true;
        let completed = false;
        const isSave = action.standard && action.name === 'save';
        let current = saved;
        setRunning(action.name);
        try {
            if (isSave || current === null || changed.current) {
                current = await save();
                if (current === null) throw new Error('Запись не сохранена');
                show(current);
            }
            if (isSave) {
                completed = true;
            } else if (action.standard) {
                // Стандартное действие возвращает обновлённую запись, и повторно читать её не нужно.
                current = await performAction<RecordData>({ object, action: action.name, payload: { guid: recordGuid(current) }, successMessage: actionSuccessMessage(action) });
                show(current);
                completed = true;
            } else {
                await performAction({ object, action: action.name, payload: input ?? {}, successMessage: actionSuccessMessage(action) });
                if (reload !== null) show(await reload());
                completed = true;
            }
        } finally {
            executing.current = false;
            setRunning(null);
            // У созданной записи появился собственный адрес: вкладка переходит на него, и повторное
            // открытие этой записи находит эту же вкладку.
            if (completed && closeAfter) tab.close();
            else if (saved === null && current !== null) tab.relocate(recordPath(object, recordGuid(current)));
        }
    };

    /** Показывает ли форма действие. Применимость к состоянию записи проверяет SDK, остальное зависит от самой формы. */
    const isVisible = (action: FormAction): boolean => {
        if (!actionApplies(action, saved)) return false;
        // Собственное действие выполняется над записанной записью и после него запись читается заново.
        if (!action.standard) return saved !== null && reload !== null;
        // Провести можно и проведённый документ: повторное проведение переписывает движения.
        // Новую запись перед проведением нужно записать, поэтому без права записи провести её нельзя.
        if (action.name === 'post') return saved !== null || editable;
        return action.name === 'save' || saved !== null;
    };

    const keyboardAction = (name: string, closeAfter = false) => {
        if (hasOpenDialog() || executing.current) return;
        const action = view.actions.find((candidate) => candidate.standard && candidate.name === name && isVisible(candidate));
        // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
        if (action !== undefined) run(action, null, closeAfter).catch(() => undefined);
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

    return (
        <Page
            title={recordTitle(object, saved)}
            tabTitle={saved === null ? `${object.title} (новый)` : recordPresentation(object, saved)}
            marks={
                <>
                    {saved !== null && saved['deletedAt'] !== null && <Tag color="error">Помечен на удаление</Tag>}
                    {saved?.['posted'] === true && <Tag color="success">Проведён</Tag>}
                </>
            }
            actions={
                <>
                    {view.actions.filter(isVisible).map((action) => (
                        <ActionButton
                            key={action.name}
                            object={object}
                            record={saved}
                            action={action.name}
                            type={action.standard && action.name === 'save' ? 'primary' : 'default'}
                            loading={running === action.name}
                            disabled={running !== null}
                            execute={(input) => run(action, input)}
                        />
                    ))}
                    <Button onClick={tab.close}>Закрыть</Button>
                </>
            }
        >
            <div
                onKeyDownCapture={(event) => {
                    if (event.key === 'Escape' && hasOpenPicker(event.target)) pickerEvents.current.add(event.nativeEvent);
                    traversal.onKeyDownCapture(event);
                }}
            >
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
                            <FieldGroup key={index} title={group.title} elements={groupElements(view, group.elements)} record={saved} disabled={!editable} traversal={traversal} />
                        ))}
                    </Flex>
                </Form>
            </div>
        </Page>
    );
}

/** Описания полей и табличных частей группы по их именам в порядке показа. */
function groupElements(view: FormView, names: ReadonlyArray<string>): Array<FormField | FormTablePart> {
    return names.flatMap((name) => {
        const element = view.fields.find((field) => field.name === name) ?? view.tableParts.find((part) => part.name === name);
        return element === undefined ? [] : [element];
    });
}
