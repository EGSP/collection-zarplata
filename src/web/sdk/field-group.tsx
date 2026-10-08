import { Card, Flex, Form, theme } from 'antd';
import type { FormField, FormTablePart } from '../../server/ui/descriptions';
import type { RecordData } from '../data-provider/records';
import { FieldDisplay, FieldInput } from '../widgets/registry';
import { fieldRules, isMarkedRequired } from '../widgets/validation';
import { fieldAttribute, type FieldTraversal } from './field-traversal';
import { TablePart } from './table-part';

/** Свойства группы полей. */
export interface FieldGroupProperties {
    /** Заголовок группы. Группа без заголовка выводится без рамки. */
    readonly title?: string | null;
    /** Поля и табличные части в порядке показа. */
    readonly elements: ReadonlyArray<FormField | FormTablePart>;
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
 */
export function FieldGroup({ title = null, elements, record = null, disabled = false, traversal }: FieldGroupProperties) {
    const { token } = theme.useToken();
    const content = (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', columnGap: token.marginLG }}>
            {elements.map((element) => {
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

/** Поле шапки. Поле только для чтения показывает значение из записи и в значения формы не входит. */
function FieldItem({ field, record, traversal }: FieldItemProperties) {
    const { token } = theme.useToken();
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
                <FieldInput field={field} ref={traversal?.register(field.name)} />
            </Form.Item>
        </div>
    );
}
