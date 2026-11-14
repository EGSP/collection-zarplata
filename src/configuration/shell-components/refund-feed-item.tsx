import { theme } from 'antd';
import { FeedCell, FeedItem, type FeedOpenEvent, FieldDisplay, Icons } from '../../web/sdk';
import { documentNumber, feedDate, feedGoods, feedTime } from './seller-feed-format';

/** Возврат в ленте рабочего места: строка функции возврата `sellerFeed` с `kind: 'refund'`. */
export interface RefundFeedRow {
    readonly kind: 'refund';
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    /** Способ расчёта с покупателем; при нескольких способах — «Сложная». */
    readonly method: string;
    /** Возвращённые товары. */
    readonly goods: ReadonlyArray<{ readonly code: string | null; readonly name: string }>;
    /** Итог возвращённых товаров в копейках. */
    readonly amount: number;
    /** Продажи-основания возврата с номером и датой. */
    readonly sales: ReadonlyArray<{ readonly guid: string; readonly number: string; readonly date: string }>;
}

/**
 * Строка возврата в ленте: значок возврата, время, номер, слово «Возврат», продажи-основания
 * с датами, возвращённые товары, способ расчёта и сумма со знаком минус: возврат уменьшает
 * выручку. Продажи названы номером и датой, потому что возврат часто оформляют по продаже
 * прошлых дней, и по дате ленты её не узнать. Заливка розовая (magenta в палитре Carbon):
 * возврат должен сразу выделяться среди продаж.
 */
export function RefundFeedItem({ row, onOpen }: { readonly row: RefundFeedRow; readonly onOpen: (event: FeedOpenEvent) => void }) {
    const { token } = theme.useToken();
    const goods = feedGoods(row.goods);
    const sales = row.sales.map((sale) => `№ ${documentNumber(sale.number)} от ${feedDate(sale.date)}`).join(', ');
    return (
        <FeedItem background={token.magenta1} hover={token.magenta2} label={`Возврат ${documentNumber(row.number)}`} onOpen={onOpen}>
            <FeedCell color={token.magenta7}><Icons.refund /></FeedCell>
            <FeedCell>{feedTime(row.date)}</FeedCell>
            <FeedCell width={8}>№ {documentNumber(row.number)}</FeedCell>
            <FeedCell strong color={token.magenta8}>Возврат</FeedCell>
            {sales !== '' && <FeedCell title={`По продажам ${sales}`}>по {sales}</FeedCell>}
            <FeedCell grow title={goods}>{goods}</FeedCell>
            <FeedCell width={14}>{row.method}</FeedCell>
            <FeedCell width={13} align="end">−<FieldDisplay field={{ kind: 'money', target: null }} value={row.amount} /></FeedCell>
        </FeedItem>
    );
}
