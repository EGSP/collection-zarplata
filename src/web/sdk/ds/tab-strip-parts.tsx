/**
 * Общие части полосы вкладок и списка вкладок: подпись с обрезкой и подсказкой, крестик закрытия
 * и описание вкладки. Полоса (`tab-strip.tsx`) и список (`tab-strip-list.tsx`) показывают одни
 * и те же вкладки, поэтому подпись и закрытие в них устроены одинаково.
 */
import { theme, Tooltip } from 'antd';
import { useLayoutEffect, useState, type CSSProperties, type ReactElement, type ReactNode, type RefObject } from 'react';
import { usePress } from 'react-aria';
import { Icons } from './icons';
import { componentSizes, iconSizes, type TypeSetProperties } from './layout';
import { Text } from './text';

/** Вкладка полосы. Порядок вкладок задаёт порядок массива. */
export interface StripTab {
    /** Ключ вкладки, уникальный в полосе. */
    readonly key: string;
    /** Подпись вкладки. У вкладки из одной иконки это постоянная подсказка и имя для диктора. */
    readonly title: string;
    /** Иконка вкладки, например у главного экрана. */
    readonly icon?: ReactNode;
    /** Квадратная вкладка только с иконкой: подпись видна в подсказке при наведении и фокусе. */
    readonly iconOnly?: boolean;
    /** Вкладку можно закрыть крестиком и клавишей Delete. */
    readonly closable?: boolean;
}

/** Наибольшая ширина вкладки в полосе, вместе с отступами и крестиком. Длинная подпись обрезается. */
export const stripTabMaxWidth = 256;

/** Подпись в одну строку с многоточием на конце. */
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };

/**
 * Обрезана ли подпись многоточием. Пересчитывается при смене ширины элемента и при смене `key`:
 * подписи и начертания, от которых ширина текста меняется без смены ширины элемента.
 */
export function useTruncated(element: RefObject<HTMLElement | null>, key: string): boolean {
    const [truncated, setTruncated] = useState(false);
    useLayoutEffect(() => {
        const label = element.current;
        if (label === null) return;
        const measure = () => setTruncated(label.scrollWidth > label.clientWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(label);
        return () => observer.disconnect();
    }, [element, key]);
    return truncated;
}

/** Свойства подписи вкладки. */
interface TabLabelProperties extends TypeSetProperties {
    readonly title: string;
    /** Жирная подпись у активной вкладки. */
    readonly strong: boolean;
    /** Элемент видимой подписи: по нему проверяется, обрезана ли она. */
    readonly labelRef: RefObject<HTMLSpanElement | null>;
}

/**
 * Подпись вкладки. Шрифт, размер и цвет даёт `Text` по набору стилей: так подпись выглядит
 * одинаково в полосе, во всплывающем окне вне корня приложения и в панели на `sm`.
 *
 * Жирная подпись шире обычной, поэтому ширину резервирует скрытая жирная копия, как у названий
 * полей (`FieldLabel`): при переключении вкладок соседние вкладки не сдвигаются. Копия исключена
 * из дерева доступности, и подпись читается один раз. Внешняя сетка с колонкой `minmax(0, …)`
 * позволяет подписи сжиматься до многоточия внутри строки и вкладки.
 */
export function TabLabel({ title, strong, labelRef, typeSet }: TabLabelProperties) {
    const { token } = theme.useToken();
    return (
        <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, max-content)', minWidth: 0, flex: '0 1 auto' }}>
            <Text typeSet={typeSet}>
                <span style={{ display: 'inline-grid', gridTemplateColumns: 'minmax(0, max-content)', maxWidth: '100%', verticalAlign: 'top' }}>
                    <span aria-hidden style={{ ...ellipsis, gridArea: '1 / 1', visibility: 'hidden', fontWeight: token.fontWeightStrong }}>{title}</span>
                    <span ref={labelRef} style={{ ...ellipsis, gridArea: '1 / 1', fontWeight: strong ? token.fontWeightStrong : undefined }}>{title}</span>
                </span>
            </Text>
        </span>
    );
}

/**
 * Подсказка с полной подписью вкладки. Показывается, только когда `shown`: вкладка обрезана
 * (или состоит из одной иконки) и на неё наведён указатель либо пришёл фокус с клавиатуры.
 * Нативный `title` не используется: он появлялся бы у всех вкладок, в том числе необрезанных.
 */
export function TabTooltip({ title, shown, children }: { readonly title: string; readonly shown: boolean; readonly children: ReactElement }) {
    return (
        <Tooltip title={title} open={shown} placement="bottom" mouseEnterDelay={0}>
            {children}
        </Tooltip>
    );
}

/**
 * Крестик закрытия вкладки. Он не получает фокус и скрыт от диктора: с клавиатуры вкладку
 * закрывает Delete, как у вкладок Carbon. Кнопка внутри вкладки дала бы вторую остановку Tab
 * и вложенный интерактивный элемент, которого роль `tab` не допускает.
 *
 * Отпускание кнопки мыши над крестиком не доходит до вкладки: иначе вкладка с выбором при
 * отпускании (`shouldSelectOnPressUp`) стала бы активной перед закрытием.
 */
export function CloseMark({ typeSet = 'productive', onClose }: TypeSetProperties & { readonly onClose: () => void }) {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);
    const { pressProps } = usePress({ onPress: onClose, preventFocusOnPress: true });
    // В крупном наборе крестик — цель для пальца: 48 px с иконкой 24 px, как в Carbon.
    const expressive = typeSet === 'expressive';
    const size = expressive ? componentSizes.lg : componentSizes.xs;
    return (
        <span
            {...pressProps}
            aria-hidden
            onPointerUp={(event) => {
                pressProps.onPointerUp?.(event);
                event.stopPropagation();
            }}
            onPointerEnter={(event) => {
                pressProps.onPointerEnter?.(event);
                setHovered(true);
            }}
            onPointerLeave={(event) => {
                pressProps.onPointerLeave?.(event);
                setHovered(false);
            }}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                flex: 'none',
                width: size,
                height: size,
                borderRadius: token.borderRadiusSM,
                color: token.colorTextSecondary,
                background: hovered ? token.colorFill : undefined,
                cursor: 'pointer',
            }}
        >
            <Icons.closeTab style={{ fontSize: expressive ? iconSizes.lg : token.fontSizeSM }} />
        </span>
    );
}
