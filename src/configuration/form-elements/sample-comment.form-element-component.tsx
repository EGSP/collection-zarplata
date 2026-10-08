import { Button, Input, Space, type InputRef } from 'antd';
import { useImperativeHandle, useRef } from 'react';
import { useFormData, type InputProperties } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Пробное поле ввода комментария пробного документа с кнопкой, которая подставляет текст «Проверено».
 * Служит образцом элемента на месте поля ввода. Он соблюдает контракт поля ввода: принимает
 * значение, сообщает об изменении и умеет принять фокус. Поэтому подпись, ошибку проверки
 * и отметку сервера показывает форма, а обход с клавиатуры останавливается на нём, как на обычном поле.
 *
 * Ввод с клавиатуры поле отдаёт обработчиком изменения, а кнопка меняет значение через данные
 * формы: так же значение любого поля изменил бы элемент, который полем ввода не является.
 * Недоступность на форме только для просмотра поле и кнопка получают от формы сами.
 */
export default function SampleComment({ value, onChange, id, ref }: InputProperties<string>) {
    const form = useFormData(Objects.document.sample);
    const input = useRef<InputRef>(null);
    useImperativeHandle(ref, () => ({ focus: () => input.current?.focus() }), []);
    return (
        <Space.Compact block>
            <Input
                ref={input}
                // Ant Design различает отсутствующее свойство и свойство со значением `undefined`.
                {...(id === undefined ? {} : { id })}
                value={value ?? ''}
                // Пустое поле отдаёт `null`: так незаполненное значение хранит сервер.
                onChange={(event) => onChange?.(event.target.value === '' ? null : event.target.value)}
            />
            <Button onClick={() => form.setValue('comment', 'Проверено')}>Проверено</Button>
        </Space.Compact>
    );
}
