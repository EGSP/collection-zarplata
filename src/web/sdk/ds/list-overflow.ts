/**
 * Поведение списка, который не помещается: таблицы данных (`DataTable`) и ленты (`Feed`). Список
 * либо разворачивается в странице, либо прокручивается внутри себя, и в обоих случаях может делить
 * строки на страницы. Поведение выбирается по точке перелома, как схема колонок таблицы.
 *
 * Значения по умолчанию задаёт платформа по дизайн-системе (`listLayoutDefaults`): на узком
 * экране вложенная вертикальная прокрутка неудобна, поэтому список развёрнут и делится
 * на страницы. Экран переопределяет только нужные точки в своей компоновке:
 *
 * ```ts
 * layouts={{
 *     sm: { lines: [...] },                                  // поведение sm — от платформы
 *     lg: { overflow: { mode: 'scroll', rows: 10 } },        // с lg прокрутка на 10 строк
 * }}
 * ```
 *
 * Размер страницы задаёт компоновка и тогда, когда страницы приходят с сервера: компонент сообщает
 * экрану номер и размер нужной страницы (`ListPagination.onChange`), а экран запрашивает её.
 */
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { breakpoints, type Breakpoint } from './layout';
import { isRendered } from './rendered';

/**
 * Поведение списка в точке перелома.
 *
 * - `expand` — строки развёрнуты в странице без своей вертикальной прокрутки. Закреплённые строки
 *   прилипают к краям прокручиваемой страницы.
 * - `scroll` — список высотой в `rows` строк прокручивается внутри себя. При `fill` он доходит
 *   до нижнего края экрана, но не ниже `rows` строк: на высоком мониторе видно больше строк.
 *
 * `pageSize` делит строки на страницы. Без него строки у клиента выводятся все, а страницы
 * с сервера получают размер `serverPageSize`: сервер не отдаёт все строки сразу.
 */
export type ListOverflow =
    | { readonly mode: 'expand'; readonly pageSize?: number | undefined }
    | { readonly mode: 'scroll'; readonly rows: number; readonly fill?: boolean | undefined; readonly pageSize?: number | undefined };

/** Запись компоновки списка в точке перелома. У таблицы к ней добавляются строки колонок. */
export interface ListLayout {
    readonly overflow?: ListOverflow | undefined;
}

/**
 * Компоновка списка по точкам перелома. Запись действует от своей точки и шире, как правило
 * CSS `min-width`.
 */
export type ListLayouts<Layout extends ListLayout = ListLayout> = { readonly [Point in Breakpoint]?: Layout };

/**
 * Значения платформы по точкам: записи компоновки, которые действуют там, где экран свою запись
 * не задал. Как и записи экрана, запись действует от своей точки и шире. Таблица добавляет к ним
 * закрепление строк (`tableLayoutDefaults` в `table-layout.ts`).
 */
export type ListLayoutDefaults<Layout extends ListLayout = ListLayout> = { readonly [Point in Breakpoint]?: Layout };

/** Размер страницы на узком экране: длинный список не уводит итоги и соседние блоки далеко вниз. */
export const compactPageSize = 10;

/** Размер страницы с сервера, если компоновка его не задала. */
export const serverPageSize = 50;

/**
 * Поведение по умолчанию у списков для чтения: на `sm` строки развёрнуты и делятся на страницы
 * по `compactPageSize`, шире развёрнуты целиком.
 */
export const listLayoutDefaults: ListLayoutDefaults = {
    sm: { overflow: { mode: 'expand', pageSize: compactPageSize } },
    md: { overflow: { mode: 'expand' } },
};

/** Значение для точки: самая широкая из названных точек, не шире текущей. */
function cascade<Value>(values: { readonly [Point in Breakpoint]?: Value }, point: Breakpoint): Value | undefined {
    let found: Value | undefined;
    for (const candidate of breakpoints) {
        found = values[candidate] ?? found;
        if (candidate === point) break;
    }
    return found;
}

/**
 * Часть компоновки в точке, например `overflow` или закрепление строк. Каждая часть выбирается
 * отдельно: запись экрана действует от своей точки и шире и стоит выше значений платформы. Экран,
 * который задал прокрутку с `lg`, получает её и на `max`, даже если у платформы есть своё значение
 * для более широкой точки. Уже записей экрана действуют значения платформы.
 */
export function layoutPartAt<Layout extends ListLayout, Value>(
    layouts: ListLayouts<Layout> | undefined,
    point: Breakpoint,
    defaults: ListLayoutDefaults<Layout>,
    part: (layout: Layout) => Value | undefined,
): Value | undefined {
    const pick = (source: ListLayouts<Layout> | undefined) => {
        const values: { [Point in Breakpoint]?: Value } = {};
        for (const candidate of breakpoints) {
            const layout = source?.[candidate];
            const value = layout === undefined ? undefined : part(layout);
            if (value !== undefined) values[candidate] = value;
        }
        return values;
    };
    return cascade(pick(layouts), point) ?? cascade(pick(defaults), point);
}

/** Поведение списка в точке (`layoutPartAt`); без записей экрана и платформы список развёрнут. */
export function listOverflowAt<Layout extends ListLayout>(layouts: ListLayouts<Layout> | undefined, point: Breakpoint, defaults: ListLayoutDefaults<Layout> = listLayoutDefaults as ListLayoutDefaults<Layout>): ListOverflow {
    return layoutPartAt(layouts, point, defaults, (layout) => layout.overflow) ?? { mode: 'expand' };
}

/** Страница, которую компонент просит у экрана при серверных страницах. */
export interface ListPage {
    readonly page: number;
    readonly pageSize: number;
}

/**
 * Страницы с сервера. Экран запрашивает страницу, которую сообщил `onChange`, и передаёт её строки
 * в `rows`, а общее число строк в `total`. Размер страницы задаёт компоновка: при смене точки
 * перелома компонент сообщает новый размер и номер страницы с прежней первой строкой. Первый
 * вызов `onChange` приходит при появлении компонента: до него экран не знает размер страницы
 * и запрос не отправляет.
 */
export interface ListPagination {
    /** Номер страницы, если его хранит экран, например чтобы вернуться к первой после поиска. */
    readonly current?: number | undefined;
    readonly total: number;
    readonly onChange: (page: ListPage) => void;
}

/** Страницы списка для отрисовки: строки текущей страницы и переключатель, если он нужен. */
export interface ListPages<Row> {
    readonly rows: ReadonlyArray<Row>;
    /** Свойства переключателя страниц; `undefined`, когда переключатель не нужен. */
    readonly control: { readonly current: number; readonly pageSize: number; readonly total: number; readonly onChange: (page: number) => void } | undefined;
}

/**
 * Страницы списка. Без `pagination` строки у клиента, и список нарезает их сам по `pageSize`
 * из компоновки. С `pagination` строки уже выбраны сервером, а список сообщает экрану нужную
 * страницу. Переключатель выводится, только когда строк больше одной страницы.
 */
export function useListPages<Row>(rows: ReadonlyArray<Row>, overflow: ListOverflow, pagination: ListPagination | undefined): ListPages<Row> {
    const server = pagination !== undefined;
    const pageSize = overflow.pageSize ?? (server ? serverPageSize : undefined);
    const [localPage, setLocalPage] = useState(1);
    const total = pagination?.total ?? rows.length;
    // Поиск и удаление могут уменьшить список: недоступная последняя страница сбрасывается.
    const pages = pageSize === undefined ? 1 : Math.max(1, Math.ceil(total / pageSize));
    const page = Math.max(1, Math.min(pagination?.current ?? localPage, pages));

    // При смене размера страницы, например при переходе через точку перелома, список остаётся
    // на странице с прежней первой строкой. Экрану с серверными страницами компонент сообщает
    // размер и при появлении: без этого первого вызова экран не знает, какую страницу запросить.
    const previousSize = useRef<number | undefined>(undefined);
    const announced = useRef(false);
    const onChange = pagination?.onChange;
    useLayoutEffect(() => {
        const previous = previousSize.current;
        previousSize.current = pageSize;
        if (previous === pageSize && announced.current) return;
        // Номер считается от страницы прежнего размера, а не от уже ограниченной новым размером.
        const current = pagination?.current ?? localPage;
        const next = previous === undefined || pageSize === undefined ? current : Math.floor(((current - 1) * previous) / pageSize) + 1;
        if (!server) {
            if (previous !== pageSize) setLocalPage(next);
            return;
        }
        announced.current = true;
        onChange?.({ page: next, pageSize: pageSize ?? serverPageSize });
    }, [pageSize, server]);

    const visible = server || pageSize === undefined ? rows : rows.slice((page - 1) * pageSize, page * pageSize);
    const control = pageSize === undefined || total <= pageSize ? undefined : {
        current: page,
        pageSize,
        total,
        onChange: (next: number) => {
            setLocalPage(next);
            onChange?.({ page: next, pageSize });
        },
    };
    return { rows: visible, control };
}

/**
 * Ближайший предок с вертикальной прокруткой: область страницы, внутри которой список должен
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
 * Высота области прокрутки, при которой список доходит до нижнего края экрана, а страница
 * не прокручивается. Область на время замера получает высоту всего экрана, и страница
 * переполняется ровно на столько, сколько у списка лишнего: на эту величину высота области
 * при замере и уменьшается.
 * Так учитывается всё вокруг списка — блоки над ним, пагинация, отступы панели и страницы — без
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
 * Высота области прокрутки списка с `fill` в пикселях или `null`, пока заполнение не нужно.
 * Пересчитывается при смене размеров страницы и рамки списка и при смене `content`, например
 * после новых строк: над списком могли появиться или исчезнуть блоки.
 */
export function useFillHeight(scroller: RefObject<HTMLElement | null>, frame: RefObject<HTMLElement | null>, enabled: boolean, content: unknown): number | null {
    const [filled, setFilled] = useState<number | null>(null);
    useLayoutEffect(() => {
        if (!enabled || scroller.current === null || frame.current === null) {
            setFilled(null);
            return;
        }
        const area = scroller.current;
        // Скрытый список (неактивная вкладка окна или панели) не имеет размеров: замер дал бы
        // отрицательную высоту, и список сжался бы до наименьшей. Поэтому он сохраняет прежнюю
        // высоту, пока скрыт, а при показе пересчитывает её по наблюдению за рамкой.
        const update = () => {
            if (isRendered(area)) setFilled(fillHeight(area));
        };
        update();
        const page = scrollParent(area);
        const observer = new ResizeObserver(update);
        observer.observe(page);
        // Рамка меняет размер при показе, даже когда область страницы осталась прежней:
        // например, список стоит на вкладке панели и скрыт вместе с ней, а строки обновились.
        observer.observe(frame.current);
        window.addEventListener('resize', update);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', update);
        };
    }, [enabled, content]);
    return filled;
}
