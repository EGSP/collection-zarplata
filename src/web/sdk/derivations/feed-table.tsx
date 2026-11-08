/** Таблица на FeedItem: денежные колонки, закреплённый заголовок и линии связанных документов. */
import { theme } from 'antd';
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { breakpointAtLeast, useBreakpoint } from '../ds/breakpoints';
import { cellAlign, cellColumnSize, type CellType } from '../ds/cell-types';
import { useOverflowShadows } from '../ds/overflow-shadows';
import { useLayer } from '../ds/layer';
import { spacing } from '../ds/layout';
import { columnTrack, type ColumnSize } from '../ds/table-layout';
import { FeedCell, FeedItem } from '../platform/feed';

export interface FeedTableColumn<Row> {
    readonly key: string;
    readonly title: string;
    /** Тип задаёт выравнивание и размеры по тем же правилам, что DataTable. */
    readonly type: CellType;
    readonly size?: ColumnSize;
    readonly render: (row: Row) => ReactNode;
    readonly summary: ReactNode;
}

export interface FeedTableProperties<Row> {
    readonly label: string;
    readonly rows: ReadonlyArray<Row>;
    readonly columns: ReadonlyArray<FeedTableColumn<Row>>;
    readonly rowKey: (row: Row) => string;
    readonly childrenOf: (row: Row) => ReadonlyArray<Row>;
    readonly appearance: (row: Row) => { readonly background: string; readonly hover: string; readonly label: string };
    readonly onOpen: (row: Row, event: MouseEvent | KeyboardEvent) => void;
    readonly isContext?: (row: Row) => boolean;
    /** Вертикальные подписанные итоги вне горизонтальной прокрутки компактного списка. */
    readonly compactSummary?: ReactNode;
}

/** Описание не увеличивает высоту строки: товары и пояснение обрезаются как текст обычного фида. */
export function FeedTableDescription({ icon, title, date, goods, note }: {
    readonly icon: ReactNode; readonly title: string; readonly date: string; readonly goods: string; readonly note?: string;
}) {
    const { token } = theme.useToken();
    const description = [note, goods].filter(Boolean).join(' ');
    return <div title={[title, date, description].join(' ')} style={{ display: 'flex', alignItems: 'baseline', gap: spacing[3], width: '100%', minWidth: 0, whiteSpace: 'nowrap' }}>
        <FeedCell>{icon}</FeedCell>
        <FeedCell strong>{title}</FeedCell>
        <FeedCell>{date}</FeedCell>
        <FeedCell grow color={note === undefined ? undefined : token.colorTextSecondary} title={description}>{description}</FeedCell>
    </div>;

}

/**
 * Числа всегда стоят одним рядом. На узкой области компактное описание занимает строку над ними;
 * при нехватке ширины прокручивается общий ряд, а не отдельные денежные ячейки.
 * На широкой области заголовок находится вне горизонтальной прокрутки и прилипает к границе вкладки.
 * На компактной области его заменяют подписи значений, итоги стоят вертикально.
 */
export function FeedTable<Row>({ label, rows, columns, rowKey, childrenOf, appearance, onOpen, isContext, compactSummary }: FeedTableProperties<Row>) {
    const { token } = theme.useToken();
    const layer = useLayer();
    const reference = useRef<HTMLDivElement>(null);
    const frame = useRef<HTMLDivElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const [headerTop, setHeaderTop] = useState(0);
    useOverflowShadows(frame, scroller);

    const wide = breakpointAtLeast(useBreakpoint(), 'lg');
    const [scrollLeft, setScrollLeft] = useState(0);
    useLayoutEffect(() => {
        if (!wide) return;
        let area = reference.current?.parentElement ?? null;
        while (area !== null && !/(auto|scroll|hidden|overlay)/u.test(getComputedStyle(area).overflowY)) area = area.parentElement;
        // Sticky отсчитывает отступ от внутреннего края страницы с padding. Заголовок
        // компенсирует верхнее поле, чтобы приклеиваться вплотную к видимой границе вкладки.
        setHeaderTop(area === null ? 0 : -parseFloat(getComputedStyle(area).paddingTop || '0'));
    }, [wide, token.paddingLG]);
    const sizes = columns.map((column) => cellColumnSize(column.type, column.title, column.size));
    const displayed = wide ? sizes : sizes.slice(1);
    const tracks = displayed.map(columnTrack).join(' ');
    const minimum = `calc(${displayed.reduce((sum, size) => sum + size.minimum, 0)}ch + ${displayed.length * 2 * spacing[3] + 2 * spacing[5]}px)`;
    const layout: CSSProperties = {
        display: 'grid', gridTemplateColumns: tracks, width: '100%', alignItems: 'stretch',
        fontSize: token.fontSize, lineHeight: token.lineHeight, fontWeight: 'normal',
        '--data-table-cell-padding': `${spacing[3]}px`,
    } as CSSProperties;
    const cellStyle = (index: number): CSSProperties => ({
        display: 'flex', flexDirection: 'column', alignItems: cellAlign(columns[index]!.type) === 'end' ? 'flex-end' : 'flex-start',
        justifyContent: 'flex-start', minWidth: 0, paddingInline: spacing[3], paddingBlock: spacing[3],
        textAlign: cellAlign(columns[index]!.type), fontVariantNumeric: 'tabular-nums',
        ...(!wide && index === 0 ? { gridColumn: '1 / -1' } : {}),
    });
    const cells = (row: Row | null, depth = 0, last = false) => {
        const context = row !== null && isContext?.(row) === true;
        return columns.flatMap((column, index) => {
            if (context && index > 0) return [];
            return <div role="cell" key={column.key} aria-colspan={context ? columns.length : undefined}
                data-feed-column={column.key}
                style={{ ...cellStyle(index), position: 'relative', ...(index === 0 ? { overflow: 'hidden', paddingInlineStart: spacing[3] + depth * spacing[9], ...(context ? { gridColumn: '1 / -1' } : {}) } : {}) }}>
                {/* Связь сдвигает только описание. Все денежные колонки сохраняют общие координаты. */}
                {index === 0 && depth > 0 && <>
                    <span aria-hidden style={{ position: 'absolute', insetInlineStart: spacing[5], top: 0, bottom: last ? '50%' : 0, borderInlineStart: `2px solid ${token.colorTextTertiary}` }} />
                    <span aria-hidden style={{ position: 'absolute', insetInlineStart: spacing[5], top: '50%', width: spacing[6], borderBlockStart: `2px solid ${token.colorTextTertiary}` }} />
                </>}
                {!wide && index > 0 && row !== null && <span style={{ color: token.colorTextSecondary, fontSize: token.fontSizeSM, whiteSpace: 'nowrap' }}>{column.title}</span>}
                {row === null ? column.summary : column.render(row)}
            </div>;
        });
    };
    const renderRow = (row: Row, depth = 0, last = false): ReactNode => {
        const children = childrenOf(row);
        return <div key={rowKey(row)}>
            <FeedItem role="row" {...appearance(row)} onOpen={(event) => onOpen(row, event)}>
                <div style={layout}>{cells(row, depth, last)}</div>
            </FeedItem>
            {children.map((child, index) => renderRow(child, depth + 1, index === children.length - 1))}
        </div>;
    };
    return <div ref={reference} role="table" aria-label={label} style={{ fontSize: token.fontSize }}>
        <div role="rowgroup" data-feed-header style={{ display: wide ? 'block' : 'none', position: 'sticky', top: headerTop, zIndex: 2, background: layer.background, borderBottom: `1px solid ${token.colorBorder}` }}>
            <div style={{ overflow: 'hidden' }}>
                <div role="row" style={{ ...layout, minWidth: minimum, boxSizing: 'border-box', paddingInline: spacing[5], transform: `translateX(${-scrollLeft}px)` }}>
                    {columns.map((column, index) => <div role="columnheader" key={column.key} style={{ ...cellStyle(index), fontWeight: token.fontWeightStrong }}>{column.title}</div>)}
                </div>
            </div>
        </div>
        <div ref={frame} style={{ position: 'relative' }}>
        <div ref={scroller} data-feed-scroll style={{ overflowX: 'auto' }} onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}>
            <div role="rowgroup" style={{ minWidth: minimum }}>
                {rows.length === 0 ? <div>Строк нет</div> : rows.map((row) => renderRow(row))}
                {wide && <div role="row" style={{ ...layout, boxSizing: 'border-box', paddingInline: spacing[5], borderTop: `1px solid ${token.colorBorder}` }}>{cells(null)}</div>}
            </div>
        </div>
        </div>
        {!wide && <div role="row" data-feed-summary style={{ padding: spacing[5], borderTop: `1px solid ${token.colorBorder}` }}>
            <div role="cell" aria-colspan={columns.length}>{compactSummary ?? columns.map((column) => <div key={column.key}>{column.key === columns[0]?.key ? null : `${column.title}: `}{column.summary}</div>)}</div>
        </div>}
    </div>;
}
