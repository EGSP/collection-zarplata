import { ConfigProvider, Flex, Segmented, Tooltip, theme, type GlobalToken } from 'antd';
import { useImperativeHandle, useRef, type ComponentType } from 'react';
import { Icons, type InputProperties } from '../../web/sdk';

/** Палитра Ant Design, которой отмечен способ оплаты. */
type MethodPalette = 'green' | 'cyan' | 'orange' | 'purple';

/**
 * Значки и цвета способов оплаты по их значениям. Значения совпадают со способами в `payments.ts`
 * и способом «Сложная» продажи; сами константы оттуда не импортируются, потому что это
 * серверный модуль, а компонент собирается в клиент.
 *
 * Цвет помогает отличать способы с первого взгляда: наличные зелёные, безналичные бирюзовые,
 * сложная оплата оранжевая, рассрочка фиолетовая.
 */
const methods: { readonly [method: string]: { readonly icon: ComponentType; readonly palette: MethodPalette } } = {
    'Наличные': { icon: Icons.cashPayment, palette: 'green' },
    'Безналичные': { icon: Icons.cashlessPayment, palette: 'cyan' },
    'Сложная': { icon: Icons.complexPayment, palette: 'orange' },
    'Рассрочка': { icon: Icons.installmentPayment, palette: 'purple' },
};

/** Основной цвет палитры из темы Ant Design: им окрашены значок способа и заливка выбранного способа. */
const paletteColor = (token: GlobalToken, palette: MethodPalette): string => token[`${palette}6`];

/**
 * Поле выбора способа оплаты кнопками со значками вместо выпадающего списка: способов два-три,
 * и продавец выбирает их одним нажатием, видя все сразу. Варианты берутся из допустимых
 * значений поля, поэтому одно поле подходит и способу оплаты продажи, и способу строки оплаты.
 *
 * С `iconsOnly` варианты показаны одними значками, а название способа видно в подсказке: так поле
 * помещается в узкую колонку таблицы оплат.
 *
 * Значок каждого способа окрашен в его цвет. Выбранный способ залит этим цветом, а текст и значок
 * на нём белые: светлая заливка с цветным текстом сливалась с остальными вариантами.
 * Обход с клавиатуры ставит фокус на выбранный вариант, а без выбора на первый; стрелки
 * переключают варианты, как у группы переключателей.
 *
 * Способы из `unavailable` показаны, но недоступны для выбора, если не выбраны в этом поле: так
 * строка оплаты не получит способ, который уже занят другой строкой.
 */
export function PaymentMethodInput({ field, value, onChange, disabled, id, ref, iconsOnly = false, unavailable = [] }: InputProperties<unknown> & { readonly iconsOnly?: boolean; readonly unavailable?: ReadonlyArray<string> }) {
    const { token } = theme.useToken();
    const root = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => ({
        focus: () => {
            const inputs = root.current?.querySelectorAll<HTMLInputElement>('input') ?? [];
            ([...inputs].find((input) => input.checked) ?? inputs[0])?.focus();
        },
    }));
    const selected = typeof value === 'string' ? methods[value] : undefined;
    const options = (field.choices ?? []).map((method) => {
        const description = methods[method];
        return {
            value: method,
            disabled: method !== value && unavailable.includes(method),
            label: iconsOnly && description !== undefined ? (
                <Tooltip title={method}>
                    <span aria-label={method} style={disabled === true || method === value ? {} : { color: paletteColor(token, description.palette) }}><description.icon /></span>
                </Tooltip>
            ) : (
                <Flex gap={6} align="center">
                    {description !== undefined && <span style={disabled === true || method === value ? {} : { color: paletteColor(token, description.palette) }}><description.icon /></span>}
                    {method}
                </Flex>
            ),
        };
    });
    // Цвет выбора задаётся теме переключателя: у Ant Design он общий для всех вариантов,
    // поэтому меняется вместе с выбранным способом.
    const segmentedTheme = selected === undefined || disabled === true ? {} : {
        itemSelectedBg: paletteColor(token, selected.palette),
        itemSelectedColor: token.colorWhite,
    };
    return (
        <ConfigProvider theme={{ components: { Segmented: segmentedTheme } }}>
            <Segmented<string>
                ref={root}
                {...(id === undefined ? {} : { id })}
                options={options}
                // Без выбранного значения ни один вариант не выделен: Ant Design выделил бы первый.
                value={typeof value === 'string' ? value : ''}
                disabled={disabled === true}
                onChange={(method) => onChange?.(method)}
            />
        </ConfigProvider>
    );
}

/** Способ строки оплаты одними значками: для узкой колонки таблицы оплат. */
export function PaymentMethodIcons(properties: InputProperties<unknown>) {
    return <PaymentMethodInput {...properties} iconsOnly />;
}

/**
 * Способ строки оплаты одними значками, когда другая строка уже оплачена рассрочкой: у продажи
 * не больше одной оплаты способом «Рассрочка», поэтому в остальных строках он недоступен.
 * Отдельный компонент, а не свойство: колонка таблицы получает компонент поля ввода, и его тип
 * должен оставаться постоянным, иначе ячейки создавались бы заново при каждой отрисовке.
 */
export function PaymentMethodIconsWithoutInstallment(properties: InputProperties<unknown>) {
    return <PaymentMethodInput {...properties} iconsOnly unavailable={['Рассрочка']} />;
}
