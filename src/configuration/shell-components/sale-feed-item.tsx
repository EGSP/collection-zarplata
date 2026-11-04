import { theme } from 'antd';
import type { KeyboardEvent, MouseEvent } from 'react';
import { FeedCell, FeedItem, FieldDisplay, Icons } from '../../web/sdk';
import { documentNumber, feedGoods, feedTime } from './seller-feed-format';

/** Продажа в ленте рабочего места: строка функции возврата `sellerFeed` с `kind: 'sale'`. */
export interface SaleFeedRow {
    readonly kind: 'sale';
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    /** Способ оплаты продажи; при нескольких способах — «Сложная». */
    readonly method: string;
    readonly goods: ReadonlyArray<{ readonly code: string | null; readonly name: string }>;
    /** Сумма продажи в копейках. */
    readonly amount: number;
}

/**
 * Строка продажи в ленте: значок кассы, время, номер, товары «код: название», способ оплаты
 * и сумма в одну линию. Заливка бирюзовая (cyan в палитре Carbon): продажа — обычная операция,
 * её строка спокойного цвета, а возврат рядом выделен розовым.
 */
export function SaleFeedItem({ row, onOpen }: { readonly row: SaleFeedRow; readonly onOpen: (event: MouseEvent | KeyboardEvent) => void }) {
    const { token } = theme.useToken();
    const goods = feedGoods(row.goods);
    return (
        <FeedItem background={token.cyan1} hover={token.cyan2} label={`Продажа ${documentNumber(row.number)}`} onOpen={onOpen}>
            <FeedCell color={token.cyan7}><Icons.sell /></FeedCell>
            <FeedCell>{feedTime(row.date)}</FeedCell>
            <FeedCell width={8}>№ {documentNumber(row.number)}</FeedCell>
            <FeedCell grow title={goods}>{goods}</FeedCell>
            <FeedCell width={14}>{row.method}</FeedCell>
            <FeedCell width={13} align="end"><FieldDisplay field={{ kind: 'money', target: null }} value={row.amount} /></FeedCell>
        </FeedItem>
    );
}
