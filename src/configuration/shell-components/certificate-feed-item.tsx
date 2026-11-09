import { theme } from 'antd';
import type { KeyboardEvent, MouseEvent } from 'react';
import { FeedCell, FeedItem, FieldDisplay, Icons } from '../../web/sdk';
import { documentNumber, feedTime } from './seller-feed-format';

/**
 * Событие сертификата в ленте рабочего места: строка функции возврата `sellerFeed` с видом
 * `certificate` (оформление) или `certificateExchange` (обмен на деньги).
 */
export interface CertificateFeedRow {
    readonly kind: 'certificate' | 'certificateExchange';
    readonly guid: string;
    readonly number: string;
    /** Дата оформления либо время обмена. */
    readonly date: string;
    /** Способ оплаты купленного сертификата, «Без оплаты» у выданного без оплаты либо способ выдачи денег при обмене. */
    readonly method: string;
    /** ФИО держателя; `null`, если физическое лицо не найдено. */
    readonly holder: string | null;
    /** Номинал в копейках: обмен всегда идёт на весь номинал. */
    readonly amount: number;
}

/**
 * Строка сертификата в ленте: значок сертификата, время, номер, событие («Сертификат» или «Обмен
 * сертификата»), держатель, способ и номинал. У обмена сумма со знаком минус: магазин выдал деньги.
 * Заливка жёлтых оттенков (gold в палитре Ant Design) отличает сертификаты от бирюзовых продаж
 * и розовых возвратов.
 */
export function CertificateFeedItem({ row, onOpen }: { readonly row: CertificateFeedRow; readonly onOpen: (event: MouseEvent | KeyboardEvent) => void }) {
    const { token } = theme.useToken();
    const exchange = row.kind === 'certificateExchange';
    const title = exchange ? 'Обмен сертификата' : 'Сертификат';
    return (
        <FeedItem background={token.gold1} hover={token.gold2} label={`${title} ${documentNumber(row.number)}`} onOpen={onOpen}>
            <FeedCell color={token.gold7}><Icons.certificate /></FeedCell>
            <FeedCell>{feedTime(row.date)}</FeedCell>
            <FeedCell width={8}>№ {documentNumber(row.number)}</FeedCell>
            <FeedCell strong color={token.gold8}>{title}</FeedCell>
            <FeedCell grow title={row.holder ?? undefined}>{row.holder ?? ''}</FeedCell>
            <FeedCell width={14}>{row.method}</FeedCell>
            <FeedCell width={13} align="end">{exchange ? '−' : ''}<FieldDisplay field={{ kind: 'money', target: null }} value={row.amount} /></FeedCell>
        </FeedItem>
    );
}
