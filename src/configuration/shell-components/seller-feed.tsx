import { useState } from 'react';
import { Feed, useFunctionResult, type FeedOpenEvent, useObjectView, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { CertificateFeedItem, type CertificateFeedRow } from './certificate-feed-item';
import { InstallmentPaymentFeedItem, type InstallmentPaymentFeedRow } from './installment-payment-feed-item';
import { RefundFeedItem, type RefundFeedRow } from './refund-feed-item';
import { SaleFeedItem, type SaleFeedRow } from './sale-feed-item';
import { feedDayKey, feedDayTitle } from './seller-feed-format';

/** Документов на странице ленты: на широком экране лента занимает его высоту, и строк нужно больше. */
const pageSize = 20;

/** Наименьшее число видимых строк на широком экране: столько видно и на невысоком мониторе. */
const minimumRows = 6;

/** Строка ленты: продажа, возврат, событие сертификата или взнос. Вид выбирает компонент строки. */
type SellerFeedRow = SaleFeedRow | RefundFeedRow | CertificateFeedRow | InstallmentPaymentFeedRow;

/**
 * Документ, который открывает строка ленты: у оформления и обмена сертификата это сам сертификат,
 * у взноса его рассрочка.
 */
const documents = {
    sale: Objects.document.sale,
    refund: Objects.document.refund,
    certificate: Objects.document.certificate,
    certificateExchange: Objects.document.certificate,
    payment: Objects.document.saleInstallment,
} as const;

/**
 * Ключ строки ленты. Один сертификат даёт две строки, оформление и обмен, поэтому одного `guid`
 * мало: ключ состоит из вида строки и `guid`. Взносы одной рассрочки различает ещё номер строки.
 */
function rowKey(row: SellerFeedRow): string {
    return row.kind === 'payment' ? `${row.kind}.${row.guid}.${row.line}` : `${row.kind}.${row.guid}`;
}

/** Компонент строки по её виду. */
function FeedRow({ row, onOpen }: { readonly row: SellerFeedRow; readonly onOpen: (event: FeedOpenEvent) => void }) {
    if (row.kind === 'sale') return <SaleFeedItem row={row} onOpen={onOpen} />;
    if (row.kind === 'refund') return <RefundFeedItem row={row} onOpen={onOpen} />;
    if (row.kind === 'payment') return <InstallmentPaymentFeedItem row={row} onOpen={onOpen} />;
    return <CertificateFeedItem row={row} onOpen={onOpen} />;
}

/**
 * Вкладка «Продажи» на рабочем месте продавца. Ленту отдаёт функция возврата `sellerFeed`;
 * без права на неё вкладки нет. Проверка стоит здесь и в странице: рабочее место выводит
 * вкладки само, без перечня требуемых объектов.
 */
export default function SellerFeed() {
    return useSellerFeedAvailable() ? <AvailableFeed /> : null;
}

/**
 * Доступна ли лента: сервер отдаёт в описании объекта только функции, на которые у пользователя
 * есть право, поэтому достаточно найти функцию в описании возврата.
 */
export function useSellerFeedAvailable(): boolean {
    return useObjectView(Objects.document.refund)?.functions.some((declared) => declared.name === 'sellerFeed') === true;
}

/**
 * Лента продавца на основе `Feed` из SDK: проведённые продажи, возвраты, события сертификатов
 * и взносы по рассрочкам по дням, поиск и страницы по 20. Каждый вид рисует собственный компонент
 * (`SaleFeedItem`, `RefundFeedItem`, `CertificateFeedItem`, `InstallmentPaymentFeedItem`): строки не обязаны совпадать. На широком экране лента занимает высоту
 * экрана, но показывает не меньше `minimumRows` строк.
 *
 * Результат функции хранится среди ответов о данных и сбрасывается после записи документа:
 * новая продажа или возврат появляются в ленте без перезагрузки страницы.
 */
function AvailableFeed() {
    const openRecord = useOpenRecord();
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const result = useFunctionResult({ object: Objects.document.refund, name: 'sellerFeed', payload: { search, page, pageSize }, keepPrevious: true });
    const rows = (result.data?.rows ?? []) as ReadonlyArray<SellerFeedRow>;
    const open = (row: SellerFeedRow) => (event: FeedOpenEvent) => {
        void openRecord(documents[row.kind], row.guid, 'tab', { original: event.shiftKey });
    };
    const searched = search.trim();
    return (
        <Feed<SellerFeedRow>
            rows={rows}
            rowKey={rowKey}
            renderRow={(row) => <FeedRow row={row} onOpen={open(row)} />}
            group={{ key: (row) => feedDayKey(row.date), render: (row) => feedDayTitle(row.date) }}
            scroll={{ rows: minimumRows, fill: true }}
            search={{ value: search, onSearch: (text) => { setSearch(text); setPage(1); }, placeholder: 'Поиск по коду, названию товара, номеру, дате или сумме' }}
            pagination={{ current: page, pageSize, total: result.data?.total ?? 0, onChange: setPage }}
            loading={result.loading}
            // Отказ, например нехватка права, оставляет результат пустым без уведомления.
            error={result.data === undefined && !result.loading ? 'Не удалось прочитать продажи и возвраты' : undefined}
            emptyText={searched === '' ? 'Продаж и возвратов пока нет' : `Нет продаж и возвратов по запросу «${searched}»`}
        />
    );
}
