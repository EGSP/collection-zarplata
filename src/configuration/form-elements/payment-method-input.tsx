import { ConfigProvider, Flex, Segmented, Tooltip, theme, type GlobalToken } from 'antd';
import { createContext, useContext, useImperativeHandle, useRef, type ComponentType } from 'react';
import { Icons, type InputProperties } from '../../web/sdk';

/** Палитра Ant Design, которой отмечен способ оплаты. */
type MethodPalette = 'green' | 'cyan' | 'orange' | 'purple' | 'gold';

/**
 * Значки и цвета способов оплаты по их значениям. Значения совпадают со способами в `payments.ts`
 * и способом «Сложная» продажи; сами константы оттуда не импортируются, потому что это
 * серверный модуль, а компонент собирается в клиент. Способ расчёта возврата «В счёт долга»
 * отмечен как рассрочка: он гасит её долг. «На сертификат» отмечен значком сертификата.
 *
 * Цвет помогает отличать способы с первого взгляда: наличные зелёные, безналичные бирюзовые,
 * сложная оплата оранжевая, рассрочка фиолетовая, сертификат жёлтый, как его строки в ленте.
 */
const methods: { readonly [method: string]: { readonly icon: ComponentType; readonly palette: MethodPalette } } = {
    'Наличные': { icon: Icons.cashPayment, palette: 'green' },
    'Безналичные': { icon: Icons.cashlessPayment, palette: 'cyan' },
    'Сложная': { icon: Icons.complexPayment, palette: 'orange' },
    'Рассрочка': { icon: Icons.installmentPayment, palette: 'purple' },
    'В счёт долга': { icon: Icons.installmentPayment, palette: 'purple' },
    'На сертификат': { icon: Icons.certificate, palette: 'gold' },
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
 * на нём белые: светлая заливка с цветным текстом сливалась с остальными вариантами. Цвета
 * сохраняются и в режиме просмотра: по ним способ узнаётся в уже проведённой продаже.
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
        const blocked = method !== value && unavailable.includes(method);
        // Выбранный вариант окрашивает тема, недоступный приглушён: цвет палитры выглядел бы активным.
        const iconStyle = method === value ? {} : { color: blocked ? token.colorTextDisabled : description === undefined ? undefined : paletteColor(token, description.palette) };
        return {
            value: method,
            disabled: blocked,
            label: iconsOnly && description !== undefined ? (
                <Tooltip title={method}>
                    <span aria-label={method} style={iconStyle}><description.icon /></span>
                </Tooltip>
            ) : (
                <Flex gap={6} align="center">
                    {description !== undefined && <span style={iconStyle}><description.icon /></span>}
                    {method}
                </Flex>
            ),
        };
    });
    // Цвет выбора задаётся теме переключателя: у Ant Design он общий для всех вариантов,
    // поэтому меняется вместе с выбранным способом. В режиме просмотра заливка та же.
    const segmentedTheme = selected === undefined ? {} : {
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

/**
 * Способы оплаты, недоступные в строках таблицы оплат. У продажи не больше одной оплаты каждого
 * способа, поэтому способ, выбранный в одной строке, таблица делает недоступным в остальных.
 *
 * Список передаётся контекстом, а не отдельным компонентом колонки: колонка получает компонент
 * поля ввода, и при смене его типа ячейки создавались бы заново. Переключатель терял бы
 * прежнее состояние, и выбор рассрочки появлялся бы без анимации перехода.
 */
export const UnavailablePaymentMethods = createContext<ReadonlyArray<string>>([]);

/** Способ строки оплаты одними значками: для узкой колонки таблицы оплат. */
export function PaymentMethodIcons(properties: InputProperties<unknown>) {
    return <PaymentMethodInput {...properties} iconsOnly unavailable={useContext(UnavailablePaymentMethods)} />;
}
