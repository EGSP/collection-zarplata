/**
 * Лента документов: строки-плашки в одну линию, сгруппированные по дням или другому ключу,
 * с поиском, пагинацией и прокруткой внутри. В отличие от `DataTable`, у ленты нет общих колонок:
 * строку рисует экран, и строки разных видов, например продажа и возврат, не обязаны совпадать.
 * Общими остаются промежуток между строками, заголовки групп, прокрутка и тени.
 *
 * Поведение при переполнении задаёт компоновка по точкам перелома (`layouts`, `list-overflow.ts`),
 * как у `DataTable`, только без колонок. По умолчанию лента развёрнута в странице, а на `sm`
 * делится на короткие страницы; экран переопределяет нужные точки, например включает прокрутку
 * внутри ленты с `lg`. Размер страницы задаёт компоновка: лента сообщает экрану номер и размер
 * нужной страницы (`pagination.onChange`), а экран запрашивает её у сервера.
 *
 * Строка, которая не помещается по ширине, не выходит за край ленты: лента прокручивается вбок,
 * как `DataTable`, а у края со скрытым содержимым видна тень. Сжимаются только ячейки `grow`,
 * поэтому наименьшая ширина ленты равна самой широкой строке без их текста.
 *
 * Лента — абстракция платформы: о документах она ничего не знает. Конфигурация собирает свою
 * ленту из `Feed` и рисует строки из `FeedItem` и `FeedCell`.
 *
 * ```tsx
 * <Feed
 *     rows={rows}
 *     rowKey={(row) => row.guid}
 *     renderRow={(row) => <FeedItem background={…} hover={…} label="Продажа 30" onOpen={open}>
 *         <FeedCell>{time}</FeedCell>
 *         <FeedCell grow>{goods}</FeedCell>
 *         <FeedCell width={13} align="end">{amount}</FeedCell>
 *     </FeedItem>}
 *     group={{ key: (row) => dayKey(row.date), render: (row) => dayTitle(row.date) }}
 *     layouts={{ lg: { overflow: { mode: 'scroll', rows: 8, fill: true, pageSize: 20 } } }}
 *     search={{ value: search, onSearch: setSearch }}
 *     pagination={{ current: page, total, onChange: ({ page, pageSize }) => load(page, pageSize) }}
 * />
 * ```
 */
import { Alert, Pagination, theme, Typography } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Key, type ReactNode } from 'react';
import { mergeProps, useFocusRing, useHover, usePress, type PressEvent } from 'react-aria';
import { useBreakpoint } from '../ds/breakpoints';
import { useLayer } from '../ds/layer';
import { spacing } from '../ds/layout';
import { listOverflowAt, useFillHeight, useListPages, type ListLayouts, type ListPagination } from '../ds/list-overflow';
import { useOverflowShadows } from '../ds/overflow-shadows';
import { isRendered } from '../ds/rendered';
import { Stack } from '../ds/stack';
import { ListSearch } from './list-search';

/** Высота строки ленты — размер `lg` у Carbon (48 px): строка в одну линию с текстом 16 px. */
export const feedItemHeight = spacing[9];

/** Промежуток между строками — микрошаг Carbon `spacing-02` (4 px): плашки читаются отдельными записями. */
const rowGap = spacing[2];

/** Высота заголовка группы — размер `sm` (32 px), ниже строки: он отделяет группы, а не спорит со строками. */
const groupHeight = spacing[7];

/**
 * Группы строк: перед строкой с новым ключом лента ставит заголовок группы, например день с полной
 * датой. Заголовок стоит и перед первой строкой страницы: группа, начатая на прошлой странице,
 * подписана снова. Лента только сравнивает ключи соседних строк, поэтому строки группы идут подряд.
 */
export interface FeedGroup<Row> {
    readonly key: (row: Row) => Key;
    /** Заголовок группы по её первой строке. */
    readonly render: (row: Row) => ReactNode;
}

/** Свойства ленты. */
export interface FeedProperties<Row> {
    readonly rows: ReadonlyArray<Row>;
    readonly rowKey: (row: Row) => Key;
    /** Строка ленты, обычно `FeedItem`. */
    readonly renderRow: (row: Row) => ReactNode;
    readonly group?: FeedGroup<Row> | undefined;
    /**
     * Компоновка по точкам перелома: поведение при переполнении (`overflow`). В режиме `scroll`
     * высота задаётся числом строк, а не пикселями, как `overflow` у списка в miracle.
     */
    readonly layouts?: ListLayouts | undefined;
    /** Поле поиска над лентой, как в форме списка. Строки отбирает источник данных экрана. */
    readonly search?: { readonly value: string; readonly onSearch: (search: string) => void; readonly placeholder?: string | undefined } | undefined;
    /**
     * Страницы с сервера: лента сообщает номер и размер нужной страницы, экран передаёт её строки
     * и общее число строк. Без свойства строки у клиента, и лента делит их на страницы сама.
     */
    readonly pagination?: ListPagination | undefined;
    readonly loading?: boolean | undefined;
    /** Сообщение об ошибке чтения вместо строк. */
    readonly error?: ReactNode;
    /** Текст пустой ленты, по умолчанию «Записей нет». */
    readonly emptyText?: ReactNode;
}

/**
 * Лента. Правила и пример описаны во вводном комментарии модуля. Рамка и область прокрутки стоят
 * всегда, и с сообщением вместо строк: хук теней находит их при первой отрисовке.
 */
export function Feed<Row>({ rows: sourceRows, rowKey, renderRow, group, layouts, search, pagination, loading = false, error, emptyText = 'Записей нет' }: FeedProperties<Row>) {
    const { token } = theme.useToken();
    const layer = useLayer();
    // Хук теней обслуживает одну ось на рамку, поэтому вокруг области прокрутки две рамки:
    // внешняя рисует тени слева и справа, внутренняя сверху и снизу.
    const horizontalFrame = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    useOverflowShadows(horizontalFrame, scroller, 'horizontal');
    useOverflowShadows(frame, scroller, 'vertical');
    const overflow = listOverflowAt(layouts, useBreakpoint());
    const pages = useListPages(sourceRows, overflow, pagination);
    const rows = pages.rows;
    const scrolling = overflow.mode === 'scroll';
    // Наименьшая высота: заголовок группы и `rows` строк с промежутками.
    const minimum = groupHeight + (overflow.mode === 'scroll' ? overflow.rows : 0) * (feedItemHeight + rowGap);
    // Помещается ли лента по ширине. Пока помещается, область без прокрутки вбок: заголовки групп
    // ленты без вертикальной прокрутки закреплены к странице. Область прокрутки вбок стала бы
    // и их областью прокрутки, и закрепление к странице пропало бы, как у `DataTable` с `pinned`.
    const [fitsWidth, setFitsWidth] = useState(true);
    useLayoutEffect(() => {
        const area = scroller.current;
        const inner = content.current;
        if (area === null || inner === null) return;
        // Ширина содержимого не меньше самой широкой строки и не зависит от `overflow`, поэтому
        // включение прокрутки не меняет результат сравнения.
        const update = () => { if (isRendered(area)) setFitsWidth(inner.getBoundingClientRect().width <= area.clientWidth + 1); };
        const observer = new ResizeObserver(update);
        observer.observe(area);
        observer.observe(inner);
        update();
        return () => observer.disconnect();
    }, []);

    // Высота по экрану пересчитывается при смене размеров страницы и после новых строк:
    // над лентой могли появиться или исчезнуть блоки.
    const filled = useFillHeight(scroller, frame, overflow.mode === 'scroll' && overflow.fill === true, rows);

    // Другая страница и другой поиск начинаются с первой строки: область возвращается к началу.
    useEffect(() => {
        if (scroller.current !== null) scroller.current.scrollTop = 0;
    }, [pages.control?.current, search?.value]);

    const groupStyle: CSSProperties = {
        position: 'sticky',
        top: 0,
        zIndex: 1,
        display: 'flex',
        alignItems: 'center',
        minHeight: groupHeight,
        // Непрозрачный фон панели: закреплённый заголовок не просвечивает строками под ним.
        background: layer.background,
        color: token.colorTextSecondary,
        fontWeight: token.fontWeightStrong,
    };

    // Строки по группам в порядке ленты; без групп — одна группа без заголовка.
    const groups: Array<{ key: Key; first: Row; rows: Row[] }> = [];
    for (const row of rows) {
        const key = group?.key(row) ?? '';
        const last = groups.at(-1);
        if (last !== undefined && last.key === key) last.rows.push(row);
        else groups.push({ key, first: row, rows: [row] });
    }

    return (
        <Stack gap={3}>
            {search !== undefined && <ListSearch value={search.value} onSearch={search.onSearch} {...(search.placeholder === undefined ? {} : { placeholder: search.placeholder })} />}
            <div ref={horizontalFrame} style={{ position: 'relative' }}>
                {/* Верхняя тень начинается под закреплённым заголовком группы: тень на нём выглядела бы так, будто скрыт он сам. */}
                <div ref={frame} style={{ position: 'relative', '--overflow-shadow-start': group === undefined ? '0px' : `${groupHeight}px` } as CSSProperties}>
                    <div ref={scroller} style={scrolling ? { maxHeight: Math.max(minimum, filled ?? minimum), overflowY: 'auto', overflowX: 'auto' } : fitsWidth ? {} : { overflowX: 'auto' }}>
                        {/* Содержимое не уже самой широкой строки: строки не сжимаются за край, а лента прокручивается вбок. */}
                        <div ref={content} style={{ minWidth: 'min-content' }}>
                            {error !== undefined && error !== null ? (
                                <Alert type="error" showIcon title={error} />
                            ) : rows.length === 0 ? (
                                <Typography.Text type="secondary">{loading ? 'Загрузка…' : emptyText}</Typography.Text>
                            ) : groups.map((part) => (
                                // Заголовок закреплён внутри своей группы: следующий вытесняет его, а не ложится поверх.
                                <section key={part.key}>
                                    {/* Подпись закреплена и слева: при прокрутке вбок она остаётся у края ленты, а не уезжает со строками. */}
                                    {group !== undefined && <div style={groupStyle}><span style={{ position: 'sticky', left: 0 }}>{group.render(part.first)}</span></div>}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap, paddingBottom: rowGap }}>
                                        {part.rows.map((row) => <div key={rowKey(row)}>{renderRow(row)}</div>)}
                                    </div>
                                </section>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
            {/* Переключатель не выводится, пока все строки помещаются на одну страницу. */}
            {pages.control !== undefined && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Pagination size="small" {...pages.control} showSizeChanger={false} />
                </div>
            )}
        </Stack>
    );
}

/**
 * Событие открытия строки ленты — нажатие из React Aria. Одно для щелчка, касания, Enter и пробела;
 * модификаторы вроде `shiftKey` в нём есть, цели и координат указателя нет.
 */
export type FeedOpenEvent = PressEvent;

/** Свойства плашки строки ленты. */
export interface FeedItemProperties {
    /** Производная таблица использует ту же строку с табличной семантикой. */
    readonly role?: 'button' | 'row';
    /** Заливка строки: экран выбирает её по виду записи, например бирюзовая у продажи. */
    readonly background: string;
    /** Заливка под курсором. */
    readonly hover: string;
    /** Подпись для экранного диктора, например вид документа и номер. */
    readonly label: string;
    /** Открытие записи щелчком, касанием, Enter или пробелом. Модификаторы, например Shift, есть в событии. */
    readonly onOpen: (event: FeedOpenEvent) => void;
    /** Ячейки строки, `FeedCell`. */
    readonly children: ReactNode;
}

/**
 * Плашка строки ленты: заливка, высота, отступы, нажатие и фокус. Текст 16 px основного цвета
 * (выразительный вид Carbon): ленту читают на ходу, а бледный текст на цветной заливке плохо
 * различим. Содержимое раскладывают ячейки `FeedCell`.
 *
 * Нажатие, наведение и обводку фокуса даёт React Aria. `useHover` не подсвечивает строку после
 * касания на сенсорном экране, а `useFocusRing` обводит строку только при фокусе с клавиатуры:
 * после щелчка мышью обводки нет, как у плиток действий.
 */
export function FeedItem({ background, hover, label, onOpen, children, role = 'button' }: FeedItemProperties) {
    const { token } = theme.useToken();
    const { pressProps } = usePress({ onPress: onOpen });
    const { hoverProps, isHovered: hovered } = useHover({});
    const { focusProps, isFocusVisible: focused } = useFocusRing();
    return (
        <div
            {...mergeProps(pressProps, hoverProps, focusProps)}
            role={role}
            tabIndex={0}
            aria-label={label}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: spacing[5],
                minHeight: feedItemHeight,
                paddingInline: spacing[5],
                boxSizing: 'border-box',
                borderRadius: token.borderRadius,
                background: hovered ? hover : background,
                color: token.colorText,
                fontSize: token.fontSizeLG,
                lineHeight: token.lineHeightLG,
                cursor: 'pointer',
                outline: focused ? `2px solid ${token.colorPrimary}` : 'none',
                outlineOffset: 2,
                transition: `background ${token.motionDurationMid}`,
            }}
        >
            {children}
        </div>
    );
}

/** Свойства ячейки строки ленты. */
export interface FeedCellProperties {
    /**
     * Ширина в знаках: значения с ней стоят столбцами по всей ленте, например способ оплаты
     * и сумма. Без неё и без `grow` ячейка своей ширины, как значок или время.
     */
    readonly width?: number | undefined;
    /** Ячейка забирает остаток строки, а длинный текст обрезается многоточием, полный — в подсказке `title`. */
    readonly grow?: boolean | undefined;
    readonly align?: 'start' | 'end' | undefined;
    /** Полужирный текст, например слово «Возврат». */
    readonly strong?: boolean | undefined;
    /** Цвет текста или значка вместо основного. */
    readonly color?: string | undefined;
    /** Полный текст в подсказке для обрезанной ячейки. */
    readonly title?: string | undefined;
    readonly children: ReactNode;
}

/** Ячейка строки ленты. Цифры одной ширины: время и суммы соседних строк не сдвигаются. */
export function FeedCell({ width, grow = false, align = 'start', strong = false, color, title, children }: FeedCellProperties) {
    const { token } = theme.useToken();
    return (
        <span
            {...(title === undefined ? {} : { title })}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: align === 'end' ? 'flex-end' : 'flex-start',
                flex: grow ? '1 1 0' : 'none',
                minWidth: 0,
                // Нулевая ширина `grow` убирает его текст из наименьшей ширины строки: ячейка
                // сжимается с многоточием, а строка не шире суммы остальных ячеек.
                ...(width === undefined ? (grow ? { width: 0 } : {}) : { width: `${width}ch` }),
                overflow: 'hidden',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
                ...(strong ? { fontWeight: token.fontWeightStrong } : {}),
                ...(color === undefined ? {} : { color }),
            }}
        >
            {/* Многоточие ставится у текста внутри ячейки: у элемента с `inline-flex` оно не работает. */}
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
        </span>
    );
}
