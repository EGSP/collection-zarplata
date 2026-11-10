import { theme } from 'antd';
import type { KeyboardEvent, MouseEvent } from 'react';
import { FeedCell, FeedItem, FieldDisplay, Icons } from '../../web/sdk';
import { documentNumber, feedTime } from './seller-feed-format';

/**
 * Последующий взнос по рассрочке в ленте рабочего места: строка функции возврата `sellerFeed`
 * с видом `payment`. Первоначальный взнос строки не получает: его деньги входят в продажу.
 */
export interface InstallmentPaymentFeedRow {
    readonly kind: 'payment';
    /** Рассрочка взноса: взнос не документ, поэтому строка открывает рассрочку. */
    readonly guid: string;
    /** Номер строки взноса в рассрочке: отличает взносы одной рассрочки. */
    readonly line: number;
    /** Номер рассрочки. */
    readonly number: string;
    /** Время внесения. */
    readonly date: string;
    /** Способ внесения: наличные или безналичные. */
    readonly method: string;
    /** ФИО покупателя; `null`, если физическое лицо не указано. */
    readonly holder: string | null;
    /** Сумма взноса в копейках. */
    readonly amount: number;
    /** Продажа рассрочки: номер показывается в строке. */
    readonly sales: ReadonlyArray<{ readonly guid: string; readonly number: string; readonly date: string }>;
}

/**
 * Строка взноса в ленте: значок приёма взноса, время, номер рассрочки, «Взнос», покупатель
 * и продажа, способ и сумма. Заливка зелёных оттенков (green в палитре) обозначает поступление
 * денег и отличает взнос от голубых продаж, пурпурных возвратов и жёлтых сертификатов.
 */
export function InstallmentPaymentFeedItem({ row, onOpen }: { readonly row: InstallmentPaymentFeedRow; readonly onOpen: (event: MouseEvent | KeyboardEvent) => void }) {
    const { token } = theme.useToken();
    const sale = row.sales[0];
    const description = [row.holder, sale === undefined ? null : `продажа № ${documentNumber(sale.number)}`].filter((part) => part !== null).join(', ');
    return (
        <FeedItem background={token.green1} hover={token.green2} label={`Взнос по рассрочке ${documentNumber(row.number)}`} onOpen={onOpen}>
            <FeedCell color={token.green7}><Icons.acceptPayment /></FeedCell>
            <FeedCell>{feedTime(row.date)}</FeedCell>
            <FeedCell width={8}>№ {documentNumber(row.number)}</FeedCell>
            <FeedCell strong color={token.green8}>Взнос</FeedCell>
            <FeedCell grow title={description}>{description}</FeedCell>
            <FeedCell width={14}>{row.method}</FeedCell>
            <FeedCell width={13} align="end"><FieldDisplay field={{ kind: 'money', target: null }} value={row.amount} /></FeedCell>
        </FeedItem>
    );
}
