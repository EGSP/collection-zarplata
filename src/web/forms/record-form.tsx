import { useHotkey } from '@tanstack/react-hotkeys';
import { Button, Flex, Form, Tag } from 'antd';
import { useEffect, useRef, useState } from 'react';
import {
    ActionButton,
    actionApplies,
    actionSuccessMessage,
    ApiError,
    FieldGroup,
    FormDataProvider,
    formFieldPaths,
    hasOpenDialog,
    hasOpenPicker,
    newRecordValues,
    Page,
    recordGuid,
    recordPresentation,
    recordTitle,
    recordValues,
    saveFields,
    serverRejectionMessage,
    useAction,
    useFieldTraversal,
    useUnsavedChanges,
    useWindowScope,
    type FormAction,
    type FormElementReference,
    type FormField,
    type FormTablePart,
    type FormValues,
    type FormView,
    type ObjectView,
    type RecordData,
} from '../sdk';
import { formElementComponent } from './form-elements';

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
 * Собственные элементы конфигурации получают значения и записанное состояние от поставщика данных
 * формы SDK и о форме Ant Design не знают. Изменение значения элементом форма учитывает так же,
 * как ввод пользователя: оно считается несохранённым и уходит в `save`.
 *
 * Форма показана в области окна и не знает, вкладка это или модальное окно. Кнопка «Закрыть» и Esc
 * закрывают область; подтверждение при несохранённых изменениях спрашивает она же. Об изменённой
 * и о созданной записи форма сообщает области: вкладка в ответ на созданную запись меняет свой
 * адрес, а модальное окно закрывается. Область может оставаться смонтированной, пока скрыта,
 * поэтому сочетания клавиш действуют только в активной. Не действуют они и в форме, поверх которой
 * открыто модальное окно, в том числе окно с другой формой.
 */
export function RecordForm({ object, view, record, reload }: RecordFormProperties) {
    const [form] = Form.useForm<FormValues>();
    const scope = useWindowScope();

    const [saved, setSaved] = useState(record);
    // Начальные значения вычисляются один раз: у новой записи в них входит текущее время.
    const [initialValues] = useState(() => (record === null ? newRecordValues(view) : recordValues(view, record)));
    /** Имя действия, которое сейчас выполняется: на это время кнопки действий недоступны. */
    const [running, setRunning] = useState<string | null>(null);

    const changed = useRef(false);
    const executing = useRef(false);
    /** Корневой элемент формы: по нему форма отличает окно, в котором показана, от окна поверх себя. */
    const root = useRef<HTMLDivElement>(null);
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
            const record: RecordData = await performAction({
                object,
                action: 'save',
                payload: saved === null ? { fields } : { guid: recordGuid(saved), fields },
                successMessage: saved === null ? 'Запись создана' : 'Запись сохранена',
                failureMessage: saved === null ? 'Не удалось создать запись' : 'Не удалось сохранить запись',
            });
            return record;
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
        /** Изменило ли действие запись на сервере. Запись перед отклонённым действием тоже считается. */
        let written = false;
        const isSave = action.standard && action.name === 'save';
        let current = saved;
        setRunning(action.name);
        try {
            if (isSave || current === null || changed.current) {
                current = await save();
                if (current === null) throw new Error('Запись не сохранена');
                show(current);
                written = true;
            }
            if (isSave) {
                completed = true;
            } else if (action.standard) {
                // Стандартное действие возвращает обновлённую запись, и повторно читать её не нужно.
                const posted: RecordData = await performAction({ object, action: action.name, payload: { guid: recordGuid(current) }, successMessage: actionSuccessMessage(action) });
                current = posted;
                show(current);
                written = true;
                completed = true;
            } else {
                await performAction({ object, action: action.name, payload: input ?? {}, successMessage: actionSuccessMessage(action) });
                written = true;
                if (reload !== null) show(await reload());
                completed = true;
            }
        } finally {
            executing.current = false;
            setRunning(null);
            // Сообщение идёт раньше закрытия: область, которая отдаёт запись открывшему её коду,
            // должна знать о записи к моменту, когда закрывается.
            if (written && current !== null) scope.recordWritten(object, recordGuid(current));
            // Что делать с созданной записью, решает область: вкладка переходит на адрес записи,
            // и повторное открытие этой записи находит эту же вкладку.
            if (completed && closeAfter) scope.close();
            else if (saved === null && current !== null) scope.recordCreated(object, recordGuid(current));
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
        if (hasOpenDialog(root.current) || executing.current) return;
        const action = view.actions.find((candidate) => candidate.standard && candidate.name === name && isVisible(candidate));
        // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
        if (action !== undefined) run(action, null, closeAfter).catch(() => undefined);
    };
    // Форма скрытой области остаётся смонтированной: без этого условия сочетание сработало бы на всех открытых формах.
    const hotkeyOptions = { ignoreInputs: false, requireReset: true, enabled: scope.active };
    useHotkey('Control+S', (event) => {
        if (!event.isComposing) keyboardAction('save');
    }, hotkeyOptions);
    useHotkey('Control+Enter', (event) => {
        if (!event.isComposing) keyboardAction('post', true);
    }, hotkeyOptions);
    // Ant Design обрабатывает Esc на window. Пока поверх формы открыто окно, событие должно дойти
    // туда и закрыть это окно, поэтому сочетание событие не останавливает.
    useHotkey('Escape', (event) => {
        if (event.isComposing || hasOpenDialog(root.current) || pickerEvents.current.has(event) || executing.current) return;
        // Esc обработала сама форма. Закрытие может открыть окно подтверждения ещё до того, как
        // событие дойдёт до window, и Ant Design закрыл бы это окно тем же нажатием.
        event.stopPropagation();
        scope.close();
    }, { ...hotkeyOptions, preventDefault: false, stopPropagation: false });

    return (
        <Page
            title={recordTitle(object, saved)}
            windowTitle={saved === null ? `${object.title} (новый)` : recordPresentation(object, saved)}
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
                    <Button onClick={scope.close}>Закрыть</Button>
                </>
            }
        >
            <div
                ref={root}
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
                    <FormDataProvider
                        object={object}
                        view={view}
                        saved={saved}
                        readOnly={!editable}
                        elements={formElementComponent}
                        onChange={() => {
                            changed.current = true;
                        }}
                    >
                        <Flex vertical gap="middle">
                            {view.groups.map((group, index) => (
                                <FieldGroup key={index} title={group.title} elements={groupElements(view, group.elements)} record={saved} disabled={!editable} traversal={traversal} />
                            ))}
                        </Flex>
                    </FormDataProvider>
                </Form>
            </div>
        </Page>
    );
}

/**
 * Элементы группы в порядке показа: описания полей и табличных частей по их именам,
 * собственные элементы конфигурации без изменений.
 */
function groupElements(view: FormView, items: ReadonlyArray<string | FormElementReference>): Array<FormField | FormTablePart | FormElementReference> {
    return items.flatMap((item): ReadonlyArray<FormField | FormTablePart | FormElementReference> => {
        if (typeof item !== 'string') return [item];
        const element = view.fields.find((field) => field.name === item) ?? view.tableParts.find((part) => part.name === item);
        return element === undefined ? [] : [element];
    });
}
