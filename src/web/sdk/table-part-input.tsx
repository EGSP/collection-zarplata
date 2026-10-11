/**
 * Контракт замены табличной части. Строки остаются в общем хранилище формы независимо
 * от выбранного представления; проверка колонок действует и без смонтированных ячеек.
 */
import { Form } from 'antd';
import type { ComponentType, Ref } from 'react';
import type { FormTablePart } from '../../server/ui/descriptions';
import type { InputHandle } from '../widgets/widget';
import { validationMessage } from '../widgets/validation';
import { TablePart } from './table-part';
import { useFormElement } from './form-data';

/**
 * Свойства компонента вместо стандартной таблицы. Значения хранятся в формате сервера.
 * Компонент соблюдает disabled и передаёт ссылку на доступный ввод; полная таблица работает
 * с тем же хранилищем формы, поэтому копировать строки при смене режима не требуется.
 */
export interface TablePartInputProperties<Row extends Record<string, unknown> = Record<string, unknown>> {
    readonly part: FormTablePart;
    readonly value?: ReadonlyArray<Row> | null | undefined;
    readonly onChange?: ((value: ReadonlyArray<Row>) => void) | undefined;
    readonly disabled?: boolean | undefined;
    readonly id?: string | undefined;
    readonly ref?: Ref<InputHandle> | undefined;
    readonly onPrevious?: (() => void) | undefined;
}

/** Проверяет все строки по описаниям колонок, даже если компонент выводит одно поле. */
export function tablePartValidationMessages(part: FormTablePart, value: unknown): ReadonlyArray<string> {
    if (!Array.isArray(value)) return ['Значение табличной части должно быть массивом строк'];
    return value.flatMap((row: unknown, index) => {
        if (typeof row !== 'object' || row === null || Array.isArray(row)) return [`Строка ${index + 1}: ожидается запись`];
        return part.columns.flatMap((column) => {
            const message = validationMessage(column, (row as Record<string, unknown>)[column.name]);
            return message === null ? [] : [`Строка ${index + 1}, ${column.title}: ${message}`];
        });
    });
}

/**
 * Связывает компонент замены с формой платформы: подпись, строки, проверка и ошибки принадлежат
 * форме. Компоненту конфигурации не нужно обращаться к форме Ant Design напрямую.
 */
export function TablePartInput({ part, ...properties }: Omit<TablePartInputProperties, 'value' | 'onChange'>) {
    const Input = useFormElement(part.inputElement) as ComponentType<TablePartInputProperties> | undefined;
    if (Input === undefined) return <TablePart part={part} {...properties} />;
    return (
        <Form.Item name={part.name} label={part.title} rules={[{
            validator: (_rule, value: unknown) => {
                const messages = tablePartValidationMessages(part, value ?? []);
                return messages.length === 0 ? Promise.resolve() : Promise.reject(new Error(messages.join('; ')));
            },
        }]}>
            <Input part={part} {...properties} />
        </Form.Item>
    );
}
