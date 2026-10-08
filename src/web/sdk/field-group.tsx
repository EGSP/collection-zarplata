import { Card, Flex, Form, theme } from 'antd';
import type { ComponentType } from 'react';
import type { FormElementReference, FormField, FormTablePart } from '../../server/ui/descriptions';
import type { RecordData } from '../data-provider/records';
import { FieldDisplay, FieldInput } from '../widgets/registry';
import { fieldRules, isMarkedRequired } from '../widgets/validation';
import type { InputProperties } from '../widgets/widget';
import { fieldAttribute, type FieldTraversal } from './field-traversal';
import { useFormElement } from './form-data';
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
                        <TablePart
                            part={element}
                            disabled={disabled}
                            ref={traversal?.register(element.name)}
                            onPrevious={traversal === undefined ? undefined : () => traversal.previous(element.name)}
                        />
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

/** Собственный элемент конфигурации в группе. Что он показывает, решает сам: данные формы он читает хуками SDK. */
function ElementBlock({ name }: { readonly name: string }) {
    // В группе элемент свойств не получает; тип свойств в реестре закрыт (`FormElementComponent`).
    const Element = useFormElement(name) as ComponentType | undefined;
    return Element === undefined ? null : <Element />;
}

/**
 * Поле шапки. Поле только для чтения показывает значение из записи и в значения формы не входит.
 * Если полю назначен собственный элемент, он стоит на месте виджета вида поля.
 */
function FieldItem({ field, record, traversal }: FieldItemProperties) {
    const { token } = theme.useToken();
    // На месте поля ввода элемент получает свойства поля ввода: значение и обработчик изменения
    // ему передаёт элемент формы Ant Design, как и виджету.
    const Input = (useFormElement(field.inputElement) as ComponentType<InputProperties<unknown>> | undefined) ?? FieldInput;
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
            <Form.Item name={field.name} label={field.title} required={isMarkedRequired(field)} rules={fieldRules(field)}>
                <Input field={field} ref={traversal?.register(field.name)} />
            </Form.Item>
        </div>
    );
}
