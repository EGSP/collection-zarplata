import { Card, ConfigProvider, Flex, Form, Space, theme } from 'antd';
import type { ComponentType } from 'react';
import type { FormElementReference, FormField, FormTablePart } from '../../server/ui/descriptions';
import type { RecordData } from '../data-provider/records';
import { FieldDisplay, FieldInput } from '../widgets/registry';
import { fieldRules, isMarkedRequired } from '../widgets/validation';
import type { InputProperties } from '../widgets/widget';
import { FluidField, type FieldInputComponent, type FieldLayout } from './field-layout';
import { fieldAttribute, type FieldTraversal } from './field-traversal';
import { useFieldRestricted, useFormElement } from './form-data';
import type { TablePartOptions } from './table-part';
import { TablePartInput } from './table-part-input';

/** Свойства группы полей. */
export interface FieldGroupProperties {
    /** Заголовок группы. Группа без заголовка выводится без рамки. */
    readonly title?: string | null;
    /** Поля, табличные части и собственные элементы конфигурации в порядке показа. */
    readonly elements: ReadonlyArray<FormField | FormTablePart | FormElementReference>;
    /**
     * Запись со служебными полями только для чтения. Вычисляемые значения берутся из текущей формы.
     */
    readonly record?: RecordData | null;
    /** Строки табличных частей нельзя изменять. Поля шапки делает недоступными сама форма Ant Design. */
    readonly disabled?: boolean;
    /** Обход с клавиатуры, в который входят поля группы. Без него поля в обходе не участвуют. */
    readonly traversal?: FieldTraversal;
    /** Настройки вида табличных частей группы по их именам: ширины колонок, строка итогов и другие. */
    readonly tablePartOptions?: { readonly [part: string]: TablePartOptions };
    /**
     * Компоновка полей группы: подпись над полем (по умолчанию) или в сегменте перед значением.
     * Составные поля и табличные части от неё не зависят и выводятся с подписью над собой.
     */
    readonly layout?: FieldLayout;
    /**
     * Поля, которые занимают всю ширину группы, а не одну колонку. Так поле с широким содержимым,
     * например переключателем и пояснением рядом, не переносит его на следующую строку.
     */
    readonly fullWidth?: ReadonlyArray<string>;
}

/**
 * Группа полей формы с подписями и ошибками проверки.
 *
 * Группа работает внутри формы Ant Design: значение поля лежит в форме по его имени, строки
 * табличной части по имени части. Отметку обязательности и правила проверки группа строит
 * из описания поля, поэтому ввод проверяется так же, как на стандартной форме, а ошибки сервера
 * экран ставит на поля средствами формы Ant Design по тем же именам.
 *
 * Поля шапки стоят в несколько колонок, табличная часть занимает всю ширину группы.
 *
 * Собственные элементы конфигурации группа берёт у поставщика данных формы (`FormDataProvider`).
 * Элемент, названный в группе, занимает всю её ширину и свойств не получает. Элемент, назначенный
 * полю, встаёт на место поля ввода и получает его свойства; подпись, проверку и обход с клавиатуры
 * поле сохраняет. Без поставщика поле выводится виджетом своего вида, а элемент группы пропускается.
 */
export function FieldGroup({ title = null, elements, record = null, disabled = false, traversal, tablePartOptions, layout = 'stacked', fullWidth = [] }: FieldGroupProperties) {
    const { token } = theme.useToken();
    const content = (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', columnGap: token.marginLG }}>
            {elements.map((element) => {
                if ('element' in element) {
                    return (
                        <div key={`element/${element.element}`} style={{ gridColumn: '1 / -1', marginBottom: token.marginLG }}>
                            <ElementBlock name={element.element} />
                        </div>
                    );
                }
                if (!('columns' in element)) {
                    const item = <FieldItem key={element.name} field={element} record={record} traversal={traversal} layout={layout} />;
                    return fullWidth.includes(element.name) ? <div key={element.name} style={{ gridColumn: '1 / -1' }}>{item}</div> : item;
                }
                return (
                    <div key={element.name} style={{ gridColumn: '1 / -1', marginBottom: token.marginLG }}>
                        <TablePartItem part={element} disabled={disabled} traversal={traversal} options={tablePartOptions?.[element.name]} />
                    </div>
                );
            })}
        </div>
    );
    if (title === null) return content;
    return (
        <Card size="small" title={title}>
            {content}
        </Card>
    );
}

interface FieldItemProperties {
    readonly field: FormField;
    readonly record: RecordData | null;
    readonly traversal: FieldTraversal | undefined;
    readonly layout: FieldLayout;
}

interface TablePartItemProperties {
    readonly part: FormTablePart;
    readonly disabled: boolean;
    readonly traversal: FieldTraversal | undefined;
    readonly options: TablePartOptions | undefined;
}

/**
 * Табличная часть группы. Часть, которую элемент формы сделал недоступной для изменения, выглядит
 * так же, как на форме только для просмотра, и в обход с клавиатуры не входит.
 */
function TablePartItem({ part, disabled, traversal, options }: TablePartItemProperties) {
    const restricted = useFieldRestricted(part.name);
    return (
        // Недоступность ячейкам передаёт контекст Ant Design, как на форме только для просмотра.
        <div {...{ [fieldAttribute]: part.name }}>
            <ConfigProvider {...(restricted ? { componentDisabled: true } : {})}>
                <TablePartInput
                    part={part}
                    options={options}
                    disabled={disabled || restricted}
                    // Обход останавливается на имени, у которого есть ссылка, поэтому недоступная часть её не получает.
                    ref={restricted ? undefined : traversal?.register(part.name)}
                    onPrevious={traversal === undefined ? undefined : () => traversal.previous(part.name)}
                />
            </ConfigProvider>
        </div>
    );
}

/** Собственный элемент конфигурации в группе. Что он показывает, решает сам: данные формы он читает хуками SDK. */
function ElementBlock({ name }: { readonly name: string }) {
    // В группе элемент свойств не получает; тип свойств в реестре закрыт (`FormElementComponent`).
    const Element = useFormElement(name) as ComponentType | undefined;
    return Element === undefined ? null : <Element />;
}

/**
 * Поле шапки. Служебное поле показывает записанное значение, вычисляемое следит за текущей формой.
 * Если полю назначен собственный элемент, он стоит на месте виджета вида поля.
 *
 * Поле, которое элемент формы сделал недоступным для изменения, остаётся полем ввода: его значение
 * по-прежнему входит в значения формы и уходит в `save`. Изменить его нельзя, и обход с клавиатуры
 * его пропускает.
 *
 * В fluid-компоновке название стоит в сегменте перед значением, а ошибка проверки по-прежнему
 * выводится под полем. Стандартный виджет форма оборачивает в сегмент сама, а собственный элемент
 * получает компоновку, название и обязательность и выводит сегмент сам (`fieldInput`).
 * Составное поле пока выводится с подписью над полем: его виджет состоит из нескольких частей.
 */
function FieldItem({ field, record, traversal, layout: groupLayout }: FieldItemProperties) {
    const { token } = theme.useToken();
    // На месте поля ввода элемент получает свойства поля ввода: значение и обработчик изменения
    // ему передаёт элемент формы Ant Design, как и виджету. Реестр элементов принимает на месте
    // поля только элементы, собранные `fieldInput`.
    const Override = useFormElement(field.inputElement) as FieldInputComponent<unknown> | undefined;
    const restricted = useFieldRestricted(field.name);
    const watched: unknown = Form.useWatch(field.name, { preserve: true });
    const layout: FieldLayout = field.kind === 'composite' ? 'stacked' : groupLayout;
    const fluid = layout === 'fluid';
    const required = isMarkedRequired(field);
    if (field.readOnly) {
        const display = <FieldDisplay field={field} value={field.computed ? watched : record?.[field.name]} />;
        if (fluid) {
            return (
                <Form.Item {...(field.computed ? { name: field.name } : {})}>
                    <FluidField label={field.title}>
                        <Space.Addon style={{ flex: 1, background: 'transparent' }}>{display}</Space.Addon>
                    </FluidField>
                </Form.Item>
            );
        }
        return (
            <Form.Item label={field.title} {...(field.computed ? { name: field.name } : {})}>
                <Flex align="center" style={{ minHeight: token.controlHeight }}>
                    {display}
                </Flex>
            </Form.Item>
        );
    }
    return (
        <div {...{ [fieldAttribute]: field.name }}>
            {/* Недоступность полю ввода и кнопкам собственного элемента передаёт контекст Ant Design, как на форме только для просмотра. */}
            <ConfigProvider {...(restricted ? { componentDisabled: true } : {})}>
                <Form.Item name={field.name} {...(fluid ? {} : { label: field.title })} required={required} rules={fieldRules(field)}>
                    {/* Обход останавливается на имени, у которого есть ссылка, поэтому недоступное поле её не получает. */}
                    <LaidOutInput field={field} override={Override} layout={layout} label={field.title} required={required} ref={restricted ? undefined : traversal?.register(field.name)} />
                </Form.Item>
            </ConfigProvider>
        </div>
    );
}

interface LaidOutInputProperties extends InputProperties<unknown> {
    readonly override: FieldInputComponent<unknown> | undefined;
    readonly layout: FieldLayout;
    readonly label: string;
    readonly required: boolean;
}

/**
 * Поле ввода в выбранной компоновке. Значение и обработчик изменения передаёт элемент формы
 * Ant Design, поэтому компонент пропускает их к полю без изменений.
 */
function LaidOutInput({ override: Override, layout, label, required, ...properties }: LaidOutInputProperties) {
    if (Override !== undefined) return <Override {...properties} layout={layout} label={label} required={required} />;
    if (layout === 'stacked') return <FieldInput {...properties} />;
    return (
        <FluidField label={label} required={required}>
            <FieldInput {...properties} />
        </FluidField>
    );
}
