/**
 * Поля ввода простых видов: строка, число, деньги, дата, дата и время, логическое значение.
 * Поле ввода ссылки лежит отдельно (`references/reference-input.tsx`): ему нужны запросы к серверу.
 *
 * Каждое поле принимает и отдаёт значение в формате сервера (`widget.ts`) и умеет принять фокус
 * по команде извне.
 */
import { Checkbox, DatePicker, Input, InputNumber, Select } from 'antd';
import dayjs from 'dayjs';
import { useCallback, useImperativeHandle, useRef, type Ref, type RefCallback } from 'react';
import { dateFormat, dateTimeFormat } from './format';
import type { InputHandle, InputProperties } from './widget';

/**
 * Связывает управление полем извне с компонентом Ant Design и возвращает ссылку для этого
 * компонента. У компонентов Ant Design разные типы ссылок, но каждый умеет принять фокус,
 * а полю ввода от них больше ничего не нужно.
 */
export function useInputHandle(ref: Ref<InputHandle> | undefined): RefCallback<InputHandle> {
    const inner = useRef<InputHandle | null>(null);
    useImperativeHandle(ref, () => ({ focus: () => inner.current?.focus() }), []);
    return useCallback((instance) => {
        inner.current = instance;
    }, []);
}

/**
 * Свойства без незаполненных значений. Элемент формы Ant Design передаёт полю не все свойства,
 * а компоненты Ant Design различают свойство со значением `undefined` и отсутствующее свойство.
 */
export function defined<Properties extends object>(properties: Properties): { [Name in keyof Properties]?: Exclude<Properties[Name], undefined> } {
    return Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined)) as { [Name in keyof Properties]?: Exclude<Properties[Name], undefined> };
}

const fullWidth = { width: '100%' };

/** Строка со свободным вводом или выбором предопределённого значения. Пустое поле отдаёт null. */
export function StringInput({ field, value, onChange, disabled, id, ref }: InputProperties<string>) {
    const inner = useInputHandle(ref);
    if (field.choices != null) return (
        <Select
            ref={inner}
            {...defined({ id, disabled })}
            style={fullWidth}
            allowClear
            value={value ?? undefined}
            options={field.choices.map((choice) => ({ value: choice, label: choice }))}
            onChange={(selected: string | undefined) => onChange?.(selected ?? null)}
        />
    );
    return (
        <Input
            ref={inner}
            {...defined({ id, disabled })}
            value={value ?? ''}
            onChange={(event) => onChange?.(event.target.value === '' ? null : event.target.value)}
        />
    );
}

/** Поле для числа. У поля с правилом `integer` дробную часть ввести нельзя. */
export function NumberInput({ field, value, onChange, disabled, id, ref }: InputProperties<number>) {
    const inner = useInputHandle(ref);
    return (
        <InputNumber<number>
            ref={inner}
            {...defined({ id, disabled })}
            style={fullWidth}
            decimalSeparator=","
            {...(field.rules?.integer === true ? { precision: 0 } : {})}
            value={value ?? null}
            onChange={(entered) => onChange?.(entered)}
        />
    );
}

/**
 * Поле для суммы. Пользователь вводит и видит рубли с двумя знаками после запятой, а значением
 * поля остаются копейки. Перевод округляется: дробные рубли в двоичном виде неточны,
 * и 19,99 × 100 без округления дало бы 1998,9999999999998.
 */
export function MoneyInput({ value, onChange, disabled, id, ref }: InputProperties<number>) {
    const inner = useInputHandle(ref);
    return (
        <InputNumber<number>
            ref={inner}
            {...defined({ id, disabled })}
            style={fullWidth}
            decimalSeparator=","
            precision={2}
            value={value === null || value === undefined ? null : value / 100}
            onChange={(roubles) => onChange?.(roubles === null ? null : Math.round(roubles * 100))}
        />
    );
}

/** Поле выбора даты в календаре. Значение поля: строка `YYYY-MM-DD`. */
export function DateInput({ value, onChange, disabled, id, ref }: InputProperties<string>) {
    const inner = useInputHandle(ref);
    return (
        <DatePicker
            ref={inner}
            {...defined({ id, disabled })}
            style={fullWidth}
            format={dateFormat}
            value={value === null || value === undefined ? null : dayjs(value)}
            onChange={(date) => onChange?.(date === null ? null : date.format('YYYY-MM-DD'))}
        />
    );
}

/**
 * Поле выбора даты и времени. Пользователь видит время по часовому поясу браузера, а значением
 * поля служит строка ISO 8601 в UTC: сервер требует часовой пояс в значении.
 */
export function DateTimeInput({ value, onChange, disabled, id, ref }: InputProperties<string>) {
    const inner = useInputHandle(ref);
    return (
        <DatePicker
            ref={inner}
            {...defined({ id, disabled })}
            style={fullWidth}
            showTime={{ format: 'HH:mm' }}
            format={dateTimeFormat}
            value={value === null || value === undefined ? null : dayjs(value)}
            onChange={(date) => onChange?.(date === null ? null : date.toISOString())}
        />
    );
}

/** Флажок. Незаполненное значение показывается снятым флажком, а после щелчка поле отдаёт `true` или `false`. */
export function BooleanInput({ value, onChange, disabled, id, ref }: InputProperties<boolean>) {
    const inner = useInputHandle(ref);
    return <Checkbox ref={inner} {...defined({ id, disabled })} checked={value === true} onChange={(event) => onChange?.(event.target.checked)} />;
}
