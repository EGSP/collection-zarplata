import { Card, ConfigProvider, Flex, Form, theme } from 'antd';
import type { ComponentType } from 'react';
import type { FormElementReference, FormField, FormTablePart } from '../../server/ui/descriptions';
import type { RecordData } from '../data-provider/records';
import { FieldDisplay, FieldInput } from '../widgets/registry';
import { fieldRules, isMarkedRequired } from '../widgets/validation';
import type { InputProperties } from '../widgets/widget';
import { fieldAttribute, type FieldTraversal } from './field-traversal';
import { useFieldRestricted, useFormElement } from './form-data';
import { TablePart } from './table-part';

/** Свойства группы полей. */
export interface FieldGroupProperties {
    /** Заголовок группы. Группа без заголовка выводится без рамки. */
    readonly title?: string | null;
    /** Поля, табличные части и собственные элементы конфигурации в порядке показа. */
    readonly elements: ReadonlyArray<FormField | FormTablePart | FormElementReference>;
    /**
     * Запись, из которой берутся значения полей только для чтения. Их заполняет платформа,
     * и в значения формы они не входят. Без записи такие поля пусты.
     */
    readonly record?: RecordData | null;
    /** Строки табличных частей нельзя изменять. Поля шапки делает недоступными сама форма Ant Design. */
    readonly disabled?: boolean;
    /** Обход с клавиатуры, в который входят поля группы. Без него поля в обходе не участвуют. */
    readonly traversal?: FieldTraversal;
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
export function FieldGroup({ title = null, elements, record = null, disabled = false, traversal }: FieldGroupProperties) {
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
                if (!('columns' in element)) return <FieldItem key={element.name} field={element} record={record} traversal={traversal} />;
                return (
                    <div key={element.name} style={{ gridColumn: '1 / -1', marginBottom: token.marginLG }}>
                        <TablePartItem part={element} disabled={disabled} traversal={traversal} />
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
}

interface TablePartItemProperties {
    readonly part: FormTablePart;
    readonly disabled: boolean;
    readonly traversal: FieldTraversal | undefined;
}

/**
 * Табличная часть группы. Часть, которую элемент формы сделал недоступной для изменения, выглядит
 * так же, как на форме только для просмотра, и в обход с клавиатуры не входит.
 */
function TablePartItem({ part, disabled, traversal }: TablePartItemProperties) {
    const restricted = useFieldRestricted(part.name);
    return (
        // Недоступность ячейкам передаёт контекст Ant Design, как на форме только для просмотра.
        <ConfigProvider {...(restricted ? { componentDisabled: true } : {})}>
            <TablePart
                part={part}
                disabled={disabled || restricted}
                // Обход останавливается на имени, у которого есть ссылка, поэтому недоступная часть её не получает.
                ref={restricted ? undefined : traversal?.register(part.name)}
                onPrevious={traversal === undefined ? undefined : () => traversal.previous(part.name)}
            />
        </ConfigProvider>
    );
}

/** Собственный элемент конфигурации в группе. Что он показывает, решает сам: данные формы он читает хуками SDK. */
function ElementBlock({ name }: { readonly name: string }) {
    // В группе элемент свойств не получает; тип свойств в реестре закрыт (`FormElementComponent`).
    const Element = useFormElement(name) as ComponentType | undefined;
    return Element === undefined ? null : <Element />;
}

/**
 * Поле шапки. Поле только для чтения показывает значение из записи и в значения формы не входит.
 * Если полю назначен собственный элемент, он стоит на месте виджета вида поля.
 *
 * Поле, которое элемент формы сделал недоступным для изменения, остаётся полем ввода: его значение
 * по-прежнему входит в значения формы и уходит в `save`. Изменить его нельзя, и обход с клавиатуры
 * его пропускает.
 */
function FieldItem({ field, record, traversal }: FieldItemProperties) {
    const { token } = theme.useToken();
    // На месте поля ввода элемент получает свойства поля ввода: значение и обработчик изменения
    // ему передаёт элемент формы Ant Design, как и виджету.
    const Input = (useFormElement(field.inputElement) as ComponentType<InputProperties<unknown>> | undefined) ?? FieldInput;
    const restricted = useFieldRestricted(field.name);
    if (field.readOnly) {
        return (
            <Form.Item label={field.title}>
                <Flex align="center" style={{ minHeight: token.controlHeight }}>
                    <FieldDisplay field={field} value={record?.[field.name]} />
                </Flex>
            </Form.Item>
        );
    }
    return (
        <div {...{ [fieldAttribute]: field.name }}>
            {/* Недоступность полю ввода и кнопкам собственного элемента передаёт контекст Ant Design, как на форме только для просмотра. */}
            <ConfigProvider {...(restricted ? { componentDisabled: true } : {})}>
                <Form.Item name={field.name} label={field.title} required={isMarkedRequired(field)} rules={fieldRules(field)}>
                    {/* Обход останавливается на имени, у которого есть ссылка, поэтому недоступное поле её не получает. */}
                    <Input field={field} ref={restricted ? undefined : traversal?.register(field.name)} />
                </Form.Item>
            </ConfigProvider>
        </div>
    );
}
