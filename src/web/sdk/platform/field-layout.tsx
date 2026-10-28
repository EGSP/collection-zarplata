/**
 * Компоновка поля на форме: подпись над полем (`stacked`) или подпись в пристыкованном к полю
 * сегменте с разделителем перед значением (`fluid`).
 *
 * Компоновку выбирает группа полей (`FieldGroup`), а не поле: в одной группе подписи выглядят
 * одинаково. Fluid-компоновка экономит высоту, поэтому подходит строкам из нескольких коротких
 * полей, например шапке документа.
 *
 * Стандартные виджеты простых полей платформа выводит в обеих компоновках сама. Составное поле
 * пока всегда выводится с подписью над полем.
 *
 * Собственный элемент на месте поля ввода обязан поддержать обе компоновки: группа решает
 * за него, как он выглядит. Поэтому такой элемент собирается функцией `fieldInput` из двух
 * компонентов, а реестр элементов при сборке клиента отклоняет элемент поля, собранный иначе.
 */
import { Space, Typography } from 'antd';
import type { ComponentType, ReactNode } from 'react';
import type { InputProperties } from '../../widgets/widget';

/** Компоновка поля: `stacked` — подпись над полем, `fluid` — подпись в сегменте перед значением. */
export type FieldLayout = 'stacked' | 'fluid';

/** Свойства поля ввода в fluid-компоновке: кроме обычных, подпись и отметка обязательности. */
export interface FluidInputProperties<Value> extends InputProperties<Value> {
    /** Название поля; выводится в сегменте перед значением. */
    readonly label: string;
    /** Поле обязательно: рядом с названием стоит звёздочка, как у подписи над полем. */
    readonly required: boolean;
}

/** Свойства, с которыми группа выводит собственный элемент поля. */
export interface LaidOutInputProperties<Value> extends FluidInputProperties<Value> {
    readonly layout: FieldLayout;
}

/** Компоненты собственного поля ввода для каждой компоновки. */
export interface FieldInputLayouts<Value> {
    /** Подпись над полем выводит форма; компонент выводит только значение. */
    readonly stacked: ComponentType<InputProperties<Value>>;
    /** Подпись выводит сам компонент, обычно обёрткой `FluidField`. */
    readonly fluid: ComponentType<FluidInputProperties<Value>>;
}

/** Метка компонента, собранного `fieldInput`: по ней реестр элементов проверяет элемент поля. */
declare const fieldInputBrand: unique symbol;

/**
 * Метка поля ввода с обеими компоновками. Её ставит только `fieldInput`, поэтому обычный компонент
 * её не имеет, и реестр элементов не примет его на месте поля.
 */
export interface FieldInputMark {
    readonly [fieldInputBrand]: true;
}

/** Собственное поле ввода, поддерживающее обе компоновки. Создаётся функцией `fieldInput`. */
export type FieldInputComponent<Value> = ((properties: LaidOutInputProperties<Value>) => ReactNode) & FieldInputMark;

/**
 * Собирает собственное поле ввода из компонентов двух компоновок. Fluid-компонент часто
 * оборачивает в `FluidField` то же содержимое, что выводит компонент с подписью над полем:
 *
 * ```tsx
 * function Comment(properties: InputProperties<string>) { return <Input … />; }
 *
 * export default fieldInput<string>({
 *     stacked: Comment,
 *     fluid: ({ label, required, ...properties }) => <FluidField label={label} required={required}><Comment {...properties} /></FluidField>,
 * });
 * ```
 */
export function fieldInput<Value>(layouts: FieldInputLayouts<Value>): FieldInputComponent<Value> {
    const { stacked: Stacked, fluid: Fluid } = layouts;
    function LaidOutInput({ layout, label, required, ...properties }: LaidOutInputProperties<Value>) {
        return layout === 'fluid' ? <Fluid {...properties} label={label} required={required} /> : <Stacked {...properties} />;
    }
    return LaidOutInput as unknown as FieldInputComponent<Value>;
}

/** Свойства обёртки fluid-поля. */
export interface FluidFieldProperties {
    /** Название поля в сегменте перед значением. */
    readonly label: string;
    readonly required?: boolean | undefined;
    /** Значение: поле ввода или отображение. Элементы Ant Design стыкуются с сегментом без зазора. */
    readonly children: ReactNode;
    /**
     * Растягивать ли поле на всю ширину места. По умолчанию растягивается; поле с содержимым
     * своей ширины, например переключателем, занимает только её, и рядом остаётся место.
     */
    readonly block?: boolean | undefined;
    /**
     * Поле шириной `free`: значение занимает ширину своего представления, а не остаток места.
     * Место в строке группы при этом остаётся не уже обычного.
     */
    readonly free?: boolean | undefined;
}

/**
 * Поле в fluid-компоновке: сегмент с названием и сразу за ним значение. Граница сегмента
 * служит разделителем. Значение, которое само не является элементом ввода Ant Design, например
 * переключатель, ставится в `Space.Addon`: тогда у него та же рамка, что у сегмента названия.
 */
export function FluidField({ label, required = false, block = true, free = false, children }: FluidFieldProperties) {
    return (
        <Space.Compact block={block} {...(free ? { style: { width: 'max-content', minWidth: '100%', maxWidth: '100%' } } : {})}>
            <Space.Addon style={{ whiteSpace: 'nowrap' }}>
                <Typography.Text type="secondary">{label}</Typography.Text>
                {required && <Typography.Text type="danger"> *</Typography.Text>}
            </Space.Addon>
            {/* Значение занимает остаток ширины и может сжиматься: без этого длинное представление
                ссылки растянуло бы поле шире места в группе. Стыковку с сегментом элементы Ant Design
                получают от `Space.Compact` через контекст, поэтому обёртка её не нарушает. */}
            {block ? <div style={{ display: 'grid', gridTemplateColumns: free ? 'max-content' : 'minmax(0, 1fr)', flex: 1, minWidth: 0 }}>{children}</div> : children}
        </Space.Compact>
    );
}
