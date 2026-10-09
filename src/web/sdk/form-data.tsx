/**
 * Данные формы записи для элементов, которые стоят на форме: собственных элементов конфигурации
 * и частей собственного экрана с формой.
 *
 * Значения формы хранит форма Ant Design, записанное состояние хранит экран формы. Элемент
 * не обращается ни к тому, ни к другому напрямую: он читает и меняет данные хуками этого модуля.
 * Так устройство формы в платформе можно сменить, не трогая элементы конфигурации.
 *
 * Данные передаются через контекст React, а не свойствами элемента: элемент в группе свойств
 * не получает вовсе, а элемент на месте поля ввода получает только контракт поля ввода.
 * Значение поля читается отдельным хуком с подпиской на одно это поле, поэтому элемент
 * перерисовывается только при изменении значений, которые читает.
 */
import { Form, type FormInstance } from 'antd';
import { createContext, useContext, useId, useLayoutEffect, useMemo, useRef, type ComponentType, type ReactNode } from 'react';
import type { FormView, ObjectView } from '../../server/ui/descriptions';
import type { PerformTarget } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';
import type { FormRestrictionRegistry, FormRestrictions } from './form-restrictions';
import type { ActedObject, FieldName, ReadObject } from './object-reference';

/**
 * Значение поля на форме по типу значения в записи. До записи поле может быть не заполнено,
 * даже если оно обязательное, поэтому к типу добавлен `null`. У табличной части это строки,
 * в которых не заполненной может быть любая ячейка.
 */
export type EnteredValue<Value> = Value extends ReadonlyArray<infer Row> ? ReadonlyArray<{ readonly [Name in keyof Row]: Row[Name] | null }> : Value | null;

/**
 * Компонент собственного элемента формы. Свойства закрыты типом `never`: что получит компонент,
 * определяет его место на форме, а не реестр. В группе компонент свойств не получает, на месте
 * поля ввода получает свойства поля ввода `InputProperties`.
 */
export type FormElementComponent = ComponentType<never>;

/** Данные формы записи типа `Record`. По ссылке на объект конфигурации запись получает точный тип. */
export interface FormData<Record extends RecordData = RecordData> {
    /** Описание объекта формы с сервера: поля, табличные части и действия, доступные пользователю. */
    readonly object: ObjectView;
    /**
     * Описание формы, на которой стоит элемент: перечень её полей, табличных частей и действий,
     * стандартных и собственных. Полей, скрытых переопределением, и действий без права здесь нет.
     */
    readonly view: FormView;
    /** Записанное состояние: запись в том виде, в каком её последним вернул сервер. У новой записи `null`. */
    readonly saved: Record | null;
    /**
     * Форма открыта только для просмотра: у пользователя нет права записи либо форму сделал
     * недоступной для изменения элемент на ней (`useFormRestrictions`). Признак установлен и на то
     * время, пока элементы ещё не сообщили форме свои ограничения.
     */
    readonly readOnly: boolean;
    /**
     * Меняет значение редактируемого поля или строки табличной части. Изменение считается
     * несохранённым, проверяется по правилам поля с показом ошибки под ним и уходит в `save`
     * вместе с остальными значениями. На форме только для просмотра и у поля, которое элемент
     * сделал недоступным для изменения, значение не меняется.
     * Имя поля, которого нет среди редактируемых полей формы, завершает вызов ошибкой:
     * значение скрытого поля или поля, которое заполняет платформа, форма не записывает.
     *
     * Вместо значения можно передать функцию, которая получает текущее значение формы и возвращает
     * новое. Так меняют значение, которое зависит от прежнего, например добавляют строку табличной
     * части: значение из `useFormValue` элемент получает с отрисовкой, и при двух изменениях подряд
     * второе, вычисленное по нему, отменило бы первое.
     */
    readonly setValue: <Field extends FieldName<Record>>(
        field: Field,
        value: EnteredValue<Record[Field]> | ((current: EnteredValue<Record[Field]>) => EnteredValue<Record[Field]>),
    ) => void;
}

/** Всё, что форма передаёт своим элементам. Форма Ant Design наружу не выходит: её читают только хуки модуля. */
interface FormDataContextValue {
    readonly data: FormData;
    readonly form: FormInstance;
    readonly restrictions: FormRestrictionRegistry | undefined;
    readonly elements: (name: string) => FormElementComponent | undefined;
}

const FormDataContext = createContext<FormDataContextValue | null>(null);

/** Свойства поставщика данных формы. */
export interface FormDataProviderProperties {
    readonly object: ObjectView;
    /** Описание формы: по нему проверяется, что изменяемое поле есть на форме и редактируется. */
    readonly view: FormView;
    /** Записанное состояние; у новой записи `null`. */
    readonly saved: RecordData | null;
    readonly readOnly: boolean;
    /**
     * Учёт ограничений формы (`useFormRestrictionRegistry`), в котором элементы объявляют свои
     * требования. Применяет их экран: по учёту он вычисляет `readOnly` и скрывает действия.
     * Без учёта элемент, который объявляет ограничения, завершается ошибкой.
     */
    readonly restrictions?: FormRestrictionRegistry;
    /** Вызывается, когда элемент изменил значение: экран отмечает у себя несохранённые изменения. */
    readonly onChange: () => void;
    /**
     * Компонент собственного элемента конфигурации по имени. Без этой функции собственных элементов
     * на форме нет: поле выводится виджетом своего вида, а элемент в группе пропускается.
     */
    readonly elements?: (name: string) => FormElementComponent | undefined;
    readonly children: ReactNode;
}

/**
 * Поставщик данных формы. Стоит внутри формы Ant Design и снаружи её групп полей: значения он
 * берёт из формы, в которой стоит, а остальное получает от экрана.
 */
export function FormDataProvider({ object, view, saved, readOnly, restrictions, onChange, elements, children }: FormDataProviderProperties) {
    const form = Form.useFormInstance();
    // Обработчик экран создаёт заново при каждой отрисовке; по ссылке данные формы от него не зависят
    // и не обновляются без причины.
    const changed = useRef(onChange);
    changed.current = onChange;
    const value = useMemo((): FormDataContextValue => {
        const data: FormData = {
            object,
            view,
            saved,
            readOnly,
            setValue: (field, entered) => {
                if (readOnly || restrictions?.isFieldReadOnly(field) === true) return;
                const editable = view.fields.some((candidate) => candidate.name === field && !candidate.readOnly) || view.tableParts.some((part) => part.name === field);
                if (!editable) throw new Error(`Поля «${field}» нет среди редактируемых полей формы «${object.title}»`);
                // Введённое значение функцией не бывает: это значение поля либо список строк.
                form.setFieldValue(field, typeof entered === 'function' ? entered((form.getFieldValue(field) ?? saved?.[field] ?? null) as never) : entered);
                // Программное изменение форма Ant Design изменением пользователя не считает
                // и сама ни о нём не сообщает, ни значение не проверяет.
                changed.current();
                // Об ошибке проверки сообщает само поле; отклонённый промис здесь только повторил бы её в консоли.
                form.validateFields([field], { recursive: true }).catch(() => undefined);
            },
        };
        return { data, form, restrictions, elements: elements ?? (() => undefined) };
    }, [object, view, saved, readOnly, restrictions, form, elements]);
    return <FormDataContext value={value}>{children}</FormDataContext>;
}

/**
 * Контекст формы для хуков данных. Завершается ошибкой вне формы и на форме другого объекта:
 * в первом случае данных нет, во втором типы записи, выведенные из ссылки, были бы неверны.
 */
function useFormDataContext(object: PerformTarget | undefined): FormDataContextValue {
    const context = useContext(FormDataContext);
    if (context === null) throw new Error('Данные формы доступны только элементу, который стоит на форме записи');
    const { kind, name } = context.data.object;
    if (object !== undefined && (object.kind !== kind || object.name !== name)) {
        throw new Error(`Элемент рассчитан на объект ${object.kind} ${object.name}, а стоит на форме объекта ${kind} ${name}`);
    }
    return context;
}

/**
 * Данные формы, на которой стоит элемент: описание объекта и формы, записанное состояние, признак
 * «только просмотр» и изменение значения поля. Элемент перерисовывается, когда форма записана
 * или перечитана либо изменились её ограничения; изменение значений полей его не перерисовывает,
 * для них служит `useFormValue`.
 *
 * `object` — ссылка на объект конфигурации, на форму которого рассчитан элемент: по ней запись
 * и имена полей получают точные типы. Без ссылки элемент подходит форме любого объекта, а запись
 * имеет общий тип. Вне формы и на форме другого объекта вызов завершается ошибкой.
 */
export function useFormData<Record extends RecordData = RecordData>(object?: ReadObject<Record>): FormData<Record> {
    // Точный тип существует только на уровне типов: форма хранит запись того объекта, с которым сверена ссылка.
    return useFormDataContext(object).data as unknown as FormData<Record>;
}

/**
 * Текущее значение поля или строки табличной части на форме вместе с несохранённым вводом.
 * Элемент перерисовывается только при изменении этого значения. У поля, которого на форме нет
 * или которое заполняет платформа, возвращается значение из записанного состояния.
 *
 * `object` задаёт типы так же, как у `useFormData`; элемент без ссылки на объект передаёт сюда
 * описание объекта из данных формы.
 */
export function useFormValue<Record extends RecordData, Field extends FieldName<Record>>(object: ReadObject<Record>, field: Field): EnteredValue<Record[Field]> {
    const context = useFormDataContext(object);
    // `preserve` следит за хранилищем формы, а не только за зарегистрированными полями: значение
    // табличной части меняется и тогда, когда удалена её последняя строка с полями.
    const watched: unknown = Form.useWatch(field, { form: context.form, preserve: true });
    // Подписка отдаёт значение только после первой отрисовки, поэтому до этого оно читается из формы напрямую.
    const entered: unknown = watched === undefined ? context.form.getFieldValue(field) : watched;
    // Сервер отдаёт запись по описанию объекта, из билдера которого выведен тип `Record`.
    return (entered === undefined ? context.data.saved?.[field] ?? null : entered) as EnteredValue<Record[Field]>;
}

/**
 * Объявляет ограничения формы, на которой стоит элемент: недоступность для изменения всей формы,
 * отдельных полей и табличных частей, скрытие действий. Ограничения действуют, пока элемент стоит
 * на форме, и объединяются с ограничениями других элементов.
 *
 * Условие элемент вычисляет сам: по записанному состоянию и значениям формы или по данным, которые
 * читает хуками SDK. Когда условие изменилось, он передаёт новые ограничения, и форма меняет
 * состояние без повторного открытия. Пока условие не известно, например данные ещё читаются,
 * элемент передаёт `null`: до ответа форма остаётся недоступной целиком и действий не показывает.
 *
 * `object` задаёт типы так же, как у `useFormData`: по ссылке на объект конфигурации компилятор
 * проверяет имена полей и действий. Вне формы, на форме другого объекта и на экране, который
 * учёт ограничений не ведёт, вызов завершается ошибкой.
 */
export function useFormRestrictions<Record extends RecordData = RecordData, Action extends string = string>(
    object: ReadObject<Record> & ActedObject<Action>,
    restrictions: FormRestrictions<FieldName<Record>, NoInfer<Action>> | null,
): void {
    const registry = useFormDataContext(object).restrictions;
    if (registry === undefined) throw new Error('Экран формы не ведёт учёт ограничений: элемент не может их объявить');
    const key = useId();
    // Элемент при каждой отрисовке создаёт новый объект ограничений. Они состоят из признаков
    // и имён, поэтому сравниваются по содержимому: иначе каждая отрисовка объявляла бы их заново.
    const content = JSON.stringify(restrictions);
    const { declare } = registry;
    // Эффект раскладки, а не обычный: форма применяет ограничения до того, как браузер её покажет.
    useLayoutEffect(() => declare(key, JSON.parse(content) as FormRestrictions | null), [declare, key, content]);
}

/**
 * Недоступно ли для изменения поле или табличная часть формы по ограничениям её элементов.
 * Нужен группе полей; в точку входа SDK не входит. Без поставщика данных и без учёта ограничений
 * ограничений нет.
 */
export function useFieldRestricted(name: string): boolean {
    return useContext(FormDataContext)?.restrictions?.isFieldReadOnly(name) ?? false;
}

/**
 * Компонент собственного элемента конфигурации по имени либо `undefined`, если элемента нет
 * или форма элементы не поставляет. Нужен группе полей; в точку входа SDK не входит.
 */
export function useFormElement(name: string | null | undefined): FormElementComponent | undefined {
    const context = useContext(FormDataContext);
    return name === null || name === undefined ? undefined : context?.elements(name);
}
