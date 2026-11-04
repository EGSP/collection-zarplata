/**
 * Лента документов: строки-плашки в одну линию, сгруппированные по дням или другому ключу,
 * с поиском, пагинацией и прокруткой внутри. В отличие от `DataTable`, у ленты нет общих колонок:
 * строку рисует экран, и строки разных видов, например продажа и возврат, не обязаны совпадать.
 * Общими остаются промежуток между строками, заголовки групп, прокрутка и тени.
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
 *     scroll={{ rows: 8, fill: true }}
 *     search={{ value: search, onSearch: setSearch }}
 *     pagination={{ current: page, pageSize: 20, total, onChange: setPage }}
 * />
 * ```
 */
import { Alert, Pagination, theme, Typography } from 'antd';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Key, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { breakpointAtLeast, useBreakpoint } from '../ds/breakpoints';
import { useLayer } from '../ds/layer';
import { spacing, type Breakpoint } from '../ds/layout';
import { useOverflowShadows } from '../ds/overflow-shadows';
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

/**
 * Прокрутка строк внутри ленты. Высота задаётся числом строк, а не пикселями, как `overflow`
 * у списка в miracle. При `fill` лента занимает высоту экрана до его нижнего края, но не меньше
 * `rows` строк: на высоком мониторе видно больше строк. Уже точки `from` (по умолчанию `lg`)
 * прокрутки нет, и лента растёт вместе со страницей: вложенная прокрутка на узком экране неудобна.
 */
export interface FeedScroll {
    readonly rows: number;
    readonly fill?: boolean | undefined;
    readonly from?: Breakpoint | undefined;
}

/** Свойства ленты. */
export interface FeedProperties<Row> {
    readonly rows: ReadonlyArray<Row>;
    readonly rowKey: (row: Row) => Key;
    /** Строка ленты, обычно `FeedItem`. */
    readonly renderRow: (row: Row) => ReactNode;
    readonly group?: FeedGroup<Row> | undefined;
    readonly scroll?: FeedScroll | undefined;
    /** Поле поиска над лентой, как в форме списка. Строки отбирает источник данных экрана. */
    readonly search?: { readonly value: string; readonly onSearch: (search: string) => void; readonly placeholder?: string | undefined } | undefined;
    /** Страницы на сервере: экран передаёт строки текущей страницы и общее число строк. */
    readonly pagination?: { readonly current: number; readonly pageSize: number; readonly total: number; readonly onChange: (page: number) => void } | undefined;
    readonly loading?: boolean | undefined;
    /** Сообщение об ошибке чтения вместо строк. */
    readonly error?: ReactNode;
    /** Текст пустой ленты, по умолчанию «Записей нет». */
    readonly emptyText?: ReactNode;
}

/**
 * Ближайший предок с вертикальной прокруткой: область страницы, внутри которой лента должна
 * поместиться. Без такого предка прокручивается сам документ.
 */
function scrollParent(element: HTMLElement): HTMLElement {
    for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') return parent;
    }
    return document.scrollingElement as HTMLElement ?? document.documentElement;
}

/**
 * Высота области прокрутки, при которой лента доходит до нижнего края экрана, а страница
 * не прокручивается. Область на время замера получает высоту всего экрана, и страница
 * переполняется ровно на столько, сколько у ленты лишнего: на эту величину высота области
 * при замере и уменьшается.
 * Так учитывается всё вокруг ленты — блоки над ней, пагинация, отступы панели и страницы — без
 * их перечисления. Если страница не переполнилась, строк меньше экрана, и ограничение не мешает.
 */
function fillHeight(scroller: HTMLElement): number {
    const page = scrollParent(scroller);
    const visible = page.clientHeight;
    const previous = scroller.style.maxHeight;
    scroller.style.maxHeight = `${visible}px`;
    // Высота области при замере, а не высота экрана: строк может быть меньше экрана, и тогда
    // область ниже своего ограничения, а переполнение страницы считается от её настоящей высоты.
    const height = scroller.getBoundingClientRect().height;
    const overflow = page.scrollHeight - page.clientHeight;
    scroller.style.maxHeight = previous;
    // Пиксель запаса: дробный масштаб страницы округляет высоты и дал бы переполнение в один пиксель.
    return height - Math.max(0, overflow) - 1;
}

/**
 * Лента. Правила и пример описаны во вводном комментарии модуля. Рамка и область прокрутки стоят
 * всегда, и с сообщением вместо строк: хук теней находит их при первой отрисовке.
 */
export function Feed<Row>({ rows, rowKey, renderRow, group, scroll, search, pagination, loading = false, error, emptyText = 'Записей нет' }: FeedProperties<Row>) {
    const { token } = theme.useToken();
    const layer = useLayer();
    const frame = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    useOverflowShadows(frame, scroller, 'vertical');
    const scrolling = scroll !== undefined && breakpointAtLeast(useBreakpoint(), scroll.from ?? 'lg');
    // Наименьшая высота: заголовок группы и `rows` строк с промежутками.
    const minimum = groupHeight + (scroll?.rows ?? 0) * (feedItemHeight + rowGap);
    const [filled, setFilled] = useState<number | null>(null);

    // Высота по экрану пересчитывается при смене размеров страницы и после новых строк:
    // над лентой могли появиться или исчезнуть блоки.
    useLayoutEffect(() => {
        if (!scrolling || scroll?.fill !== true || scroller.current === null) {
            setFilled(null);
            return;
        }
        const area = scroller.current;
        const update = () => setFilled(fillHeight(area));
        update();
        const page = scrollParent(area);
        const observer = new ResizeObserver(update);
        observer.observe(page);
        window.addEventListener('resize', update);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [scrolling, scroll?.fill, rows]);

    // Другая страница и другой поиск начинаются с первой строки: область возвращается к началу.
    useEffect(() => {
        if (scroller.current !== null) scroller.current.scrollTop = 0;
    }, [pagination?.current, search?.value]);

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
            {/* Верхняя тень начинается под закреплённым заголовком группы: тень на нём выглядела бы так, будто скрыт он сам. */}
            <div ref={frame} style={{ position: 'relative', '--overflow-shadow-start': group === undefined ? '0px' : `${groupHeight}px` } as CSSProperties}>
                <div ref={scroller} style={scrolling ? { maxHeight: Math.max(minimum, filled ?? minimum), overflowY: 'auto' } : {}}>
                    {error !== undefined && error !== null ? (
                        <Alert type="error" showIcon title={error} />
                    ) : rows.length === 0 ? (
                        <Typography.Text type="secondary">{loading ? 'Загрузка…' : emptyText}</Typography.Text>
                    ) : groups.map((part) => (
                        // Заголовок закреплён внутри своей группы: следующий вытесняет его, а не ложится поверх.
                        <section key={part.key}>
                            {group !== undefined && <div style={groupStyle}>{group.render(part.first)}</div>}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: rowGap, paddingBottom: rowGap }}>
                                {part.rows.map((row) => <div key={rowKey(row)}>{renderRow(row)}</div>)}
                            </div>
                        </section>
                    ))}
                </div>
            </div>
            {pagination !== undefined && pagination.total > pagination.pageSize && (
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <Pagination size="small" current={pagination.current} pageSize={pagination.pageSize} total={pagination.total} showSizeChanger={false} onChange={pagination.onChange} />
                </div>
            )}
        </Stack>
    );
}

/** Свойства плашки строки ленты. */
export interface FeedItemProperties {
    /** Заливка строки: экран выбирает её по виду записи, например бирюзовая у продажи. */
    readonly background: string;
    /** Заливка под курсором. */
    readonly hover: string;
    /** Подпись для экранного диктора, например вид документа и номер. */
    readonly label: string;
    readonly onOpen: (event: MouseEvent | KeyboardEvent) => void;
    /** Ячейки строки, `FeedCell`. */
    readonly children: ReactNode;
}

/**
 * Плашка строки ленты: заливка, высота, отступы, нажатие и фокус. Текст 16 px основного цвета
 * (выразительный вид Carbon): ленту читают на ходу, а бледный текст на цветной заливке плохо
 * различим. Содержимое раскладывают ячейки `FeedCell`.
 */
export function FeedItem({ background, hover, label, onOpen, children }: FeedItemProperties) {
    const { token } = theme.useToken();
    const [hovered, setHovered] = useState(false);
    const [focused, setFocused] = useState(false);
    return (
        <div
            role="button"
            tabIndex={0}
            aria-label={label}
            onClick={onOpen}
            onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onOpen(event);
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            // Щелчок мышью не требует обводки; клавиатурный фокус остаётся видимым, как у плиток действий.
            onFocus={(event) => setFocused(event.currentTarget.matches(':focus-visible'))}
            onBlur={() => setFocused(false)}
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
                ...(width === undefined ? {} : { width: `${width}ch` }),
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
