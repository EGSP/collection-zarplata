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
    /** Способ оплаты продажи; при нескольких способах — «Сложная», при полной оплате сертификатами пусто. */
    readonly method: string;
    readonly goods: ReadonlyArray<{ readonly code: string | null; readonly name: string }>;
    /** Сумма продажи в копейках. */
    readonly amount: number;
    /** В продаже применён хотя бы один купон. */
    readonly coupon: boolean;
    /** Продажа оплачена хотя бы одним сертификатом. */
    readonly certificate: boolean;
}

/**
 * Строка продажи в ленте: значок кассы, время, номер, товары «код: название», способ оплаты
 * и сумма в одну линию. Перед способом стоят значок купона, если в продаже применён купон,
 * и значок сертификата, если продажа оплачена сертификатом. У продажи, целиком оплаченной
 * сертификатами, способа нет, и стоит только значок сертификата. Заливка бирюзовая (cyan в палитре Carbon): продажа — обычная операция,
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
            <FeedCell width={14}>
                {row.coupon && <Icons.coupon title="Применён купон" aria-label="Применён купон" style={{ marginInlineEnd: 6 }} />}
                {row.certificate && <Icons.certificate title="Оплачено сертификатом" aria-label="Оплачено сертификатом" style={{ marginInlineEnd: 6 }} />}
                {row.method}
            </FeedCell>
            <FeedCell width={13} align="end"><FieldDisplay field={{ kind: 'money', target: null }} value={row.amount} /></FeedCell>
        </FeedItem>
    );
}
