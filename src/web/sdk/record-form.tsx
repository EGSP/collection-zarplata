/**
 * Форма записи справочника или документа из частей: хук `useRecordForm` с поведением формы
 * и компоненты раскладки. Из них собрана стандартная форма `StandardRecordForm`, и из них же
 * собирается собственная форма конфигурации, которой нужна другая раскладка, но то же поведение.
 * Собственной форме, которой в одном из мест показа менять нечего, достаточно вернуть там
 * `StandardRecordForm`.
 *
 * Хук подключает форму к области окна через `useRecordFormContract`: собственная форма на этом хуке
 * выполняет контракт без дополнительного кода. Части раскладки получают состояние хука свойством
 * `state` и могут заменяться по отдельности: например, форма выводит свои группы полей,
 * а кнопки действий и каркас страницы берёт стандартные.
 */
import { useHotkey } from '@tanstack/react-hotkeys';
import { Button, Flex, Form, Tag, type FormInstance } from 'antd';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import type { FormAction, FormElementReference, FormField, FormGroup, FormTablePart, FormView, ObjectView } from '../../server/ui/descriptions';
import { ApiError } from '../common/api';
import { useAction } from '../data-provider/actions';
import { recordGuid, type RecordData } from '../data-provider/records';
import { RecordMoreActions } from '../journal/record-journal';
import { recordTitle, useRecordPresentation } from '../references/presentation';
import { formFieldPaths, serverRejectionMessage } from '../widgets/validation';
import { useWindowScope } from '../window/window-scope';
import { ActionButton, actionApplies, actionSuccessMessage } from './action-button';
import { FieldGroup } from './field-group';
import { useFieldTraversal, type FieldTraversal } from './field-traversal';
import { FormDataProvider } from './form-data';
import { useFormRestrictionRegistry, type FormRestrictionRegistry } from './form-restrictions';
import { Icons } from './icons';
import { hasOpenDialog, hasOpenPicker } from './keyboard';
import type { NewFormProperties, RecordFormProperties } from './object-form-properties';
import { Page } from './page';
import { useRecordFormContract, useRecordFormHost, type RecordFormActionInput, type RecordFormRunOptions } from './record-form-contract';
import { newRecordValues, recordValues, saveFields, type FormValues } from './record-values';

/** Состояние формы записи: то, что хук `useRecordForm` передаёт частям раскладки. */
export interface RecordFormState {
    readonly object: ObjectView;
    readonly view: FormView;
    /** Форма Ant Design со значениями полей. */
    readonly form: FormInstance<FormValues>;
    /** Начальные значения полей: из записи либо значения по умолчанию новой записи. */
    readonly initialValues: FormValues;
    /** Записанное состояние: запись в том виде, в каком её последним вернул сервер. У новой записи `null`. */
    readonly record: RecordData | null;
    /** Имя действия, которое сейчас выполняется; на это время кнопки действий недоступны. */
    readonly running: string | null;
    /** Можно ли менять значения: есть действие `save`, и элементы формы не сделали её недоступной. */
    readonly editable: boolean;
    /** Учёт ограничений, которые объявляют элементы формы. */
    readonly restrictions: FormRestrictionRegistry;
    /** Обход полей с клавиатуры в порядке описания формы. */
    readonly traversal: FieldTraversal;
    /** Видимые действия в порядке кнопок: «Провести», «Записать», затем остальные. */
    readonly actions: ReadonlyArray<FormAction>;
    /** Видимое стандартное проведение; по нему выводится кнопка «Провести и закрыть». */
    readonly postAction: FormAction | undefined;
    /** Выполняет действие формы с записью несохранённых изменений перед ним (`RecordFormController.run`). */
    readonly run: (action: FormAction, input?: RecordFormActionInput, options?: RecordFormRunOptions) => Promise<unknown>;
    /** Выполняет действие по имени для элемента формы: имя ищется среди действий с правом пользователя. */
    readonly runByName: (name: string, input: FormValues | null) => Promise<unknown>;
    /** Перечитывает запись с сервера и показывает её на форме (`FormData.reload`). У новой записи ничего не делает. */
    readonly reloadRecord: () => Promise<void>;
    /** Отмечает несохранённые изменения. Вызывается, когда значение изменил пользователь или элемент формы. */
    readonly markChanged: () => void;
    /** Есть ли на форме несохранённые изменения. По нему форма решает, можно ли перечитать запись без потери ввода. */
    readonly hasChanges: () => boolean;
    /** Корневой элемент формы: по нему форма отличает окно, в котором показана, от окна поверх себя. */
    readonly root: RefObject<HTMLDivElement | null>;
    /** Перехват нажатий корневого элемента: обход полей по Enter и Esc в открытом списке выбора. */
    readonly onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => void;
}

/** Настройки поведения формы записи. */
export interface RecordFormOptions {
    /**
     * Готовит значения перед записью: получает все значения формы и возвращает исправленные либо
     * `undefined`, если менять нечего. Исправленные значения форма показывает и записывает, поэтому
     * пользователь видит то же, что сохранено. Так форма продажи превращает сложную оплату из одной
     * строки в простую.
     */
    readonly beforeSave?: ((values: FormValues) => FormValues | undefined) | undefined;
    /**
     * Новый документ записывается и проводится одним запросом: при отказе проведения запись
     * не создаётся. Действует на кнопки, Ctrl+Enter и `run` формы, пока вызов не задал `atomic` сам
     * (`RecordFormRunOptions.atomic`). Так возврат не остаётся черновиком после отказа проведения.
     */
    readonly atomicPosting?: boolean | undefined;
}

/**
 * Поведение стандартной формы записи: записанное состояние, запись с разметкой ошибок сервера
 * под полями, действия, ограничения элементов, обход полей и сочетания клавиш Ctrl+S, Ctrl+Enter
 * и Esc. Подключает форму к области окна, поэтому вызывается один раз в компоненте формы записи
 * или новой записи. Принимает свойства формы целиком: у формы новой записи записи нет.
 *
 * Все действия, кроме «Записать», применяются к записанному состоянию. Поэтому при несохранённых
 * изменениях хук сначала записывает их отдельным запросом и только затем выполняет действие.
 * Объединить запросы в один пакет нельзя: у новой записи до ответа на запись нет `guid`,
 * который нужен действию. Если действие после успешной записи отклонено, запись остаётся
 * сохранённой, и форма показывает её сохранённое состояние.
 *
 * Форма без действия `save` в описании открывается только для просмотра. Недоступной для изменения
 * форму, отдельное поле или табличную часть может сделать и собственный элемент конфигурации,
 * и он же может скрыть действие. Пока ограничения не собраны, форма недоступна целиком и действий
 * не показывает: иначе запись, которую менять нельзя, на время выглядела бы изменяемой.
 *
 * Область может оставаться смонтированной, пока скрыта, поэтому сочетания клавиш действуют только
 * в активной. Не действуют они и в форме, поверх которой открыто модальное окно.
 */
export function useRecordForm(properties: RecordFormProperties | NewFormProperties, options: RecordFormOptions = {}): RecordFormState {
    const { object, view } = properties;
    const initial = 'record' in properties ? properties.record : null;
    const given = 'initial' in properties ? properties.initial : undefined;
    const reload = 'reload' in properties ? properties.reload : null;
    const [form] = Form.useForm<FormValues>();
    const scope = useWindowScope();
    const performAction = useAction();
    // Начальные значения вычисляются один раз: у новой записи в них входит текущее время.
    // Значения, переданные открывшим форму, стоят поверх значений по умолчанию.
    const [initialValues] = useState(() => (initial === null ? { ...newRecordValues(view), ...given } : recordValues(view, initial)));
    const changed = useRef(false);
    const root = useRef<HTMLDivElement>(null);
    // Виджет может закрыть выбор до глобального обработчика Escape. Сохраняем состояние до события.
    const pickerEvents = useRef(new WeakSet<globalThis.KeyboardEvent>());

    const restrictions = useFormRestrictionRegistry();
    const editable = view.actions.some((action) => action.name === 'save') && !restrictions.readOnly;
    const traversal = useFieldTraversal(view.traversal, editable);

    const controller = useRecordFormContract({
        changed: () => changed.current,
        show: (next) => {
            form.setFieldsValue(recordValues(view, next));
            // Ошибки сервера относились к прежним значениям и сами при замене значений не исчезают.
            form.setFields(
                form
                    .getFieldsError()
                    .filter((field) => field.errors.length > 0)
                    .map((field) => ({ name: field.name, errors: [] })),
            );
            changed.current = false;
        },
        save: async (saved, post) => {
            const prepared = options.beforeSave?.(form.getFieldsValue(true) as FormValues);
            if (prepared !== undefined) form.setFieldsValue(prepared);
            let entered: FormValues;
            try {
                entered = await form.validateFields();
            } catch {
                const first = form.getFieldsError().find((field) => field.errors.length > 0);
                if (first !== undefined) form.scrollToField(first.name, { focus: true, block: 'center' });
                return null;
            }
            // Новая запись записывается поверх значений, которые передал открывший форму: среди них
            // могут быть поля, скрытые на форме, например основание продажи из отвеса.
            const fields = saveFields(view, saved ?? given ?? null, entered);
            try {
                const record: RecordData = await performAction({
                    object,
                    action: 'save',
                    // Запись и проведение одним запросом: отказ проведения не оставляет черновика.
                    payload: saved === null ? { fields, ...(post === undefined ? {} : { post: true }) } : { guid: recordGuid(saved), fields },
                    successMessage: post !== undefined ? actionSuccessMessage(post) : saved === null ? 'Запись создана' : 'Запись сохранена',
                    failureMessage: saved === null ? 'Не удалось создать запись' : 'Не удалось сохранить запись',
                });
                return record;
            } catch (error) {
                // Текст сервера показало уведомление. Отдельного текста на каждое поле у сервера нет,
                // поэтому поля из его перечня только отмечаются.
                if (error instanceof ApiError && error.statusCode === 400) {
                    const paths = formFieldPaths(error.fields, 'payload.fields.');
                    // Ячейка может быть не смонтирована: тогда ошибка остаётся и у части, и по исходному пути.
                    const fallbacks = paths.flatMap((name) => {
                        const part = view.tableParts.find((candidate) => candidate.name === name[0] && candidate.inputElement != null);
                        return part !== undefined && form.getFieldInstance(name) === undefined ? [[part.name]] : [];
                    });
                    form.setFields([...paths, ...fallbacks].map((name) => ({ name, errors: [serverRejectionMessage] })));
                }
                return null;
            }
        },
        perform: async (action, input, saved) => {
            if (action.standard) {
                // Стандартное действие возвращает обновлённую запись, и повторно читать её не нужно.
                const record: RecordData = await performAction({ object, action: action.name, payload: { guid: recordGuid(saved) }, successMessage: actionSuccessMessage(action) });
                return { record, result: record };
            }
            const result: unknown = await performAction({ object, action: action.name, payload: input ?? {}, successMessage: actionSuccessMessage(action) });
            return { record: reload === null ? null : await reload(), result };
        },
    });
    const saved = controller.record;

    const focused = useRef(false);
    useEffect(() => {
        // Пока ограничения не собраны, поля недоступны и фокус принять не могут.
        if (initial !== null || focused.current || restrictions.pending) return;
        // Фокус ставится один раз при открытии формы.
        focused.current = true;
        // В новой записи пользователь сразу начинает ввод с первого поля порядка обхода.
        traversal.focusFirst();
    }, [restrictions.pending]);

    /**
     * Показывает ли форма действие. Применимость к состоянию записи проверяет SDK, остальное зависит
     * от самой формы и от ограничений её элементов. По этой же проверке работают сочетания клавиш.
     */
    const isVisible = (action: FormAction): boolean => {
        // Команды просмотра выводит меню «Ещё»: они не должны сохранять или изменять запись.
        if (action.opens !== undefined) return false;
        if (restrictions.isActionHidden(action.name) || !actionApplies(action, saved)) return false;
        // Собственное действие выполняется над записанной записью и после него запись читается заново.
        if (!action.standard) return saved !== null && reload !== null;
        // Провести можно и проведённый документ: повторное проведение переписывает движения.
        // Новую запись перед проведением нужно записать, поэтому без права записи провести её нельзя.
        if (action.name === 'post') return saved !== null || editable;
        // Записывать на форме, недоступной для изменения, нечего.
        return action.name === 'save' ? editable : saved !== null;
    };

    const runByName = (name: string, input: FormValues | null): Promise<unknown> => {
        const action = view.actions.find((candidate) => candidate.name === name && candidate.opens === undefined);
        return action === undefined ? Promise.reject(new Error(`Действия «${name}» нет среди действий формы «${object.title}»`)) : controller.run(action, input);
    };

    const reloadRecord = async (): Promise<void> => {
        if (reload === null || saved === null) return;
        controller.show(await reload());
    };

    const keyboardAction = (name: string, close = false) => {
        if (hasOpenDialog(root.current) || controller.isRunning()) return;
        const action = view.actions.find((candidate) => candidate.standard && candidate.name === name && isVisible(candidate));
        // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
        if (action !== undefined) controller.run(action, null, { close, ...(options.atomicPosting === true ? { atomic: true } : {}) }).catch(() => undefined);
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
        if (event.isComposing || hasOpenDialog(root.current) || pickerEvents.current.has(event) || controller.isRunning()) return;
        // Esc обработала сама форма. Закрытие может открыть окно подтверждения ещё до того, как
        // событие дойдёт до window, и Ant Design закрыл бы это окно тем же нажатием.
        event.stopPropagation();
        scope.close();
    }, { ...hotkeyOptions, preventDefault: false, stopPropagation: false });

    const visibleActions = view.actions.filter(isVisible);
    const postAction = visibleActions.find((action) => action.standard && action.name === 'post');
    // Главная кнопка и сочетание Ctrl+Enter используют одну проверку доступности проведения.
    const actions = postAction === undefined ? visibleActions : [
        postAction,
        ...visibleActions.filter((action) => action.standard && action.name === 'save'),
        ...visibleActions.filter((action) => action !== postAction && !(action.standard && action.name === 'save')),
    ];

    return {
        object,
        view,
        form,
        initialValues,
        record: saved,
        running: controller.running,
        editable,
        restrictions,
        traversal,
        actions,
        postAction,
        run: (action, input, runOptions) => controller.run(action, input, { ...(options.atomicPosting === true ? { atomic: true } : {}), ...runOptions }),
        runByName,
        reloadRecord,
        markChanged: () => {
            changed.current = true;
        },
        hasChanges: () => changed.current,
        root,
        onKeyDownCapture: (event) => {
            if (event.key === 'Escape' && hasOpenPicker(event.target)) pickerEvents.current.add(event.nativeEvent);
            traversal.onKeyDownCapture(event);
        },
    };
}

/** Свойства частей формы записи. */
export interface RecordFormPartProperties {
    /** Состояние формы из `useRecordForm`. */
    readonly state: RecordFormState;
}

/** Свойства тела формы записи. */
export interface RecordFormBodyProperties extends RecordFormPartProperties {
    /** Содержимое формы: группы полей и собственные блоки. */
    readonly children: ReactNode;
}

/**
 * Тело формы записи: форма Ant Design со значениями, данные формы для элементов конфигурации
 * и перехват клавиш для обхода полей. Всё, что выводит поля, ставится внутрь тела.
 */
export function RecordFormBody({ state, children }: RecordFormBodyProperties) {
    const { elements } = useRecordFormHost();
    return (
        <div ref={state.root} onKeyDownCapture={state.onKeyDownCapture}>
            <Form form={state.form} layout="vertical" disabled={!state.editable} initialValues={state.initialValues} onValuesChange={state.markChanged}>
                <FormDataProvider
                    object={state.object}
                    view={state.view}
                    saved={state.record}
                    readOnly={!state.editable}
                    restrictions={state.restrictions}
                    elements={elements}
                    onAction={state.runByName}
                    onReload={state.reloadRecord}
                    onChange={state.markChanged}
                >
                    {children}
                </FormDataProvider>
            </Form>
        </div>
    );
}

/** Свойства раскладки групп формы записи. */
export interface RecordFormLayoutProperties extends RecordFormPartProperties {
    /** Группы для вывода; по умолчанию все группы описания формы в их порядке. */
    readonly groups?: ReadonlyArray<FormGroup>;
}

/**
 * Группы полей формы записи по описанию формы. Ставится внутрь `RecordFormBody`.
 *
 * На форме новой записи служебные поля вроде номера документа и флажка «Проведён» не выводятся:
 * их заполняет платформа при записи, и до неё поле показывало бы пустое значение, которое нельзя
 * изменить. Группа, в которой после этого не осталось элементов, тоже не выводится.
 */
export function RecordFormLayout({ state, groups = state.view.groups }: RecordFormLayoutProperties) {
    const shown = groups
        .map((group) => ({ title: group.title, elements: recordFormElements(state, group.elements) }))
        .filter((group) => group.elements.length > 0);
    return (
        <Flex vertical gap="middle">
            {shown.map((group, index) => (
                <FieldGroup key={index} title={group.title} elements={group.elements} record={state.record} disabled={!state.editable} traversal={state.traversal} />
            ))}
        </Flex>
    );
}

/**
 * Элементы формы записи в порядке показа: поля и табличные части по именам, собственные элементы
 * конфигурации без изменений. Служебные поля новой записи пропускаются, как в `RecordFormLayout`.
 * Собственная форма с другой раскладкой собирает так же свои группы для `FieldGroup`:
 *
 * ```tsx
 * <FieldGroup elements={recordFormElements(state, ['date', 'comment'])} traversal={state.traversal} />
 * ```
 */
export function recordFormElements(state: RecordFormState, items: ReadonlyArray<string | FormElementReference>): Array<FormField | FormTablePart | FormElementReference> {
    return groupElements(state.view, items).filter((element) => state.record !== null || !isManagedField(element));
}

/** Служебное поле: его значение заполняет платформа, а не пользователь или вычисление формы. */
function isManagedField(element: FormField | FormTablePart | FormElementReference): boolean {
    return !('element' in element) && !('columns' in element) && element.readOnly && element.computed === null;
}

/**
 * Подписи кнопок формы записи вместо стандартных. Подпись меняет только показ: действие, права,
 * сочетания клавиш и уведомления остаются прежними.
 *
 * Собственная форма задаёт подписи там, где стандартные не подходят по смыслу. Например,
 * запись новой смены открывает её, а закрытие окна без записи отменяет открытие:
 *
 * ```tsx
 * <RecordFormPage state={state} titles={{ actions: { save: 'Открыть' }, close: 'Отменить' }}>
 * ```
 */
export interface RecordFormTitles {
    /**
     * Подписи действий по именам: стандартных (`save`, `post`) и собственных. Они заменяют название
     * действия из описания формы на кнопке, в её подсказке и в названии для чтения с экрана.
     */
    readonly actions?: { readonly [action: string]: string };
    /** Подпись кнопки «Провести и закрыть». */
    readonly postAndClose?: string;
    /** Подпись кнопки «Закрыть», которая закрывает форму без записи. */
    readonly close?: string;
}

/**
 * Какие кнопки действий показывает форма записи. Скрытая кнопка убирает только кнопку: действие
 * остаётся доступным собственной кнопке формы и сочетаниям клавиш.
 *
 * Собственная форма скрывает стандартные кнопки, когда выводит своё главное действие сама.
 * Например, новая продажа оставляет только «Закрыть», а проводит её крупная кнопка «Продать»
 * под оплатами:
 *
 * ```tsx
 * <RecordFormPage state={state} buttons={{ actions: [], postAndClose: false }}>
 * ```
 */
export interface RecordFormButtons {
    /** Имена действий, кнопки которых выводятся. По умолчанию выводятся кнопки всех видимых действий. */
    readonly actions?: ReadonlyArray<string>;
    /** Выводить ли кнопку «Провести и закрыть». По умолчанию выводится, если документ можно провести. */
    readonly postAndClose?: boolean;
}

/** Свойства кнопок действий формы записи. */
export interface RecordFormActionsProperties extends RecordFormPartProperties {
    /** Подписи кнопок вместо стандартных. */
    readonly titles?: RecordFormTitles;
    /** Какие кнопки действий выводятся. «Закрыть» выводится всегда. */
    readonly buttons?: RecordFormButtons;
}

/** Кнопки действий формы записи: «Провести и закрыть», видимые действия и «Закрыть». */
export function RecordFormActions({ state, titles = {}, buttons = {} }: RecordFormActionsProperties) {
    const { close } = useWindowScope();
    const { postAction, running } = state;
    // Рядом с «Провести и закрыть» проведение и запись сжаты до значков; без неё они подписаны.
    const compact = (action: FormAction) => postAction !== undefined && buttons.postAndClose !== false && action.standard && (action.name === 'post' || action.name === 'save');
    const title = (action: FormAction) => titles.actions?.[action.name] ?? action.title;
    const postAndClose = titles.postAndClose ?? 'Провести и закрыть';
    const shown = state.actions.filter((action) => buttons.actions?.includes(action.name) ?? true);
    return (
        <>
            {postAction !== undefined && buttons.postAndClose !== false && (
                <ActionButton
                    object={state.object}
                    record={state.record}
                    action={postAction.name}
                    type="primary"
                    tooltip={`${postAndClose} (Ctrl+Enter)`}
                    loading={running === postAction.name}
                    disabled={running !== null}
                    execute={async (input) => {
                        await state.run(postAction, input, { close: true });
                    }}
                >
                    {postAndClose}
                </ActionButton>
            )}
            {shown.map((action) => (
                <ActionButton
                    key={action.name}
                    object={state.object}
                    record={state.record}
                    action={action.name}
                    type={postAction === undefined && action.standard && action.name === 'save' ? 'primary' : 'default'}
                    icon={compact(action) ? (action.name === 'post' ? <Icons.post /> : <Icons.save />) : undefined}
                    aria-label={compact(action) ? title(action) : undefined}
                    tooltip={action.standard ? (action.name === 'save' ? `${title(action)} (Ctrl+S)` : action.name === 'post' ? title(action) : undefined) : undefined}
                    loading={running === action.name}
                    disabled={running !== null}
                    execute={async (input) => {
                        await state.run(action, input);
                    }}
                >
                    {compact(action) ? '' : title(action)}
                </ActionButton>
            ))}
            <RecordMoreActions object={state.object} record={state.record} />
            <Button onClick={close}>{titles.close ?? 'Закрыть'}</Button>
        </>
    );
}

/** Отметки состояния записи рядом с заголовком: «Помечен на удаление» и «Проведён». */
export function RecordFormMarks({ state }: RecordFormPartProperties) {
    const { record } = state;
    return (
        <>
            {record !== null && record['deletedAt'] !== null && <Tag color="error">Помечен на удаление</Tag>}
            {record?.['posted'] === true && <Tag color="success">Проведён</Tag>}
        </>
    );
}

/** Свойства каркаса страницы формы записи. */
export interface RecordFormPageProperties extends RecordFormBodyProperties {
    /** Подписи кнопок вместо стандартных; их получает `RecordFormActions`. */
    readonly titles?: RecordFormTitles;
    /** Какие кнопки действий выводятся; их получает `RecordFormActions`. */
    readonly buttons?: RecordFormButtons;
}

/**
 * Каркас страницы формы записи: заголовок по представлению записи, отметки, кнопки действий
 * и тело формы с содержимым `children`. Стандартная форма выводит в нём `RecordFormLayout`.
 */
export function RecordFormPage({ state, titles, buttons, children }: RecordFormPageProperties) {
    // Представление читается по записанному состоянию: несохранённый выбор ссылки запись ещё не называет.
    const presentation = useRecordPresentation(state.object, state.record);
    return (
        <Page
            title={recordTitle(state.object, state.record === null ? null : presentation.text)}
            windowTitle={state.record === null ? `${state.object.title} (новый)` : presentation.text}
            marks={<RecordFormMarks state={state} />}
            actions={<RecordFormActions state={state} {...(titles === undefined ? {} : { titles })} {...(buttons === undefined ? {} : { buttons })} />}
        >
            <RecordFormBody state={state}>{children}</RecordFormBody>
        </Page>
    );
}

/**
 * Стандартная форма записи справочника или документа по описанию формы с сервера: каркас страницы
 * формы и все группы полей. Её показывает область окна, если конфигурация не заменила форму.
 *
 * Собственная форма может вернуть её целиком, например только в модальном окне:
 *
 * ```tsx
 * export default function SaleNewForm(properties: NewFormProperties) {
 *     if (properties.presentation === 'dialog') return <StandardRecordForm {...properties} />;
 *     return <SaleFullForm {...properties} />;
 * }
 * ```
 *
 * Ветвление должно стоять до `useRecordForm`: стандартная форма подключает контракт с областью
 * окна сама, и второй контракт в той же форме область отклонит. Поэтому собственная раскладка
 * выносится в отдельный компонент. Место показа за время жизни формы не меняется, так что
 * ветвление не нарушает порядок хуков.
 */
export function StandardRecordForm(properties: RecordFormProperties | NewFormProperties) {
    const state = useRecordForm(properties);
    return (
        <RecordFormPage state={state}>
            <RecordFormLayout state={state} />
        </RecordFormPage>
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
