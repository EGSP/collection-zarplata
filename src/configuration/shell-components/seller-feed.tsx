import { useState } from 'react';
import { Feed, useFunctionResult, type FeedOpenEvent, type ListLayouts, type ListPage, useObjectView, useOpenRecord } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { CertificateFeedItem, type CertificateFeedRow } from './certificate-feed-item';
import { InstallmentPaymentFeedItem, type InstallmentPaymentFeedRow } from './installment-payment-feed-item';
import { RefundFeedItem, type RefundFeedRow } from './refund-feed-item';
import { SaleFeedItem, type SaleFeedRow } from './sale-feed-item';
import { feedDayKey, feedDayTitle } from './seller-feed-format';

/**
 * Компоновка ленты. На `sm` действует поведение платформы: лента развёрнута и делится на короткие
 * страницы. С `md` страницы по 20 документов. С `lg` лента прокручивается внутри себя и занимает
 * высоту экрана, но показывает не меньше 6 строк: столько видно и на невысоком мониторе.
 */
const layouts: ListLayouts = {
    md: { overflow: { mode: 'expand', pageSize: 20 } },
    lg: { overflow: { mode: 'scroll', rows: 6, fill: true, pageSize: 20 } },
};

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
 * и взносы по рассрочкам по дням, поиск и страницы. Каждый вид рисует собственный компонент
 * (`SaleFeedItem`, `RefundFeedItem`, `CertificateFeedItem`, `InstallmentPaymentFeedItem`):
 * строки не обязаны совпадать. Размер страницы и прокрутку задаёт компоновка `layouts`; лента
 * сообщает номер и размер нужной страницы, и только после этого экран запрашивает её.
 *
 * Результат функции хранится среди ответов о данных и сбрасывается после записи документа:
 * новая продажа или возврат появляются в ленте без перезагрузки страницы.
 */
function AvailableFeed() {
    const openRecord = useOpenRecord();
    const [search, setSearch] = useState('');
    // Страница неизвестна, пока лента не сообщила размер страницы из компоновки.
    const [page, setPage] = useState<ListPage | null>(null);
    const result = useFunctionResult({
        object: Objects.document.refund,
        name: 'sellerFeed',
        payload: { search, page: page?.page ?? 1, pageSize: page?.pageSize ?? 0 },
        enabled: page !== null,
        keepPrevious: true,
    });
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
            layouts={layouts}
            // Новый поиск начинается с первой страницы того же размера.
            search={{ value: search, onSearch: (text) => { setSearch(text); setPage((current) => current === null ? null : { ...current, page: 1 }); }, placeholder: 'Поиск по коду, названию товара, номеру, дате или сумме' }}
            pagination={{ ...(page === null ? {} : { current: page.page }), total: result.data?.total ?? 0, onChange: setPage }}
            loading={result.loading || page === null}
            // Отказ, например нехватка права, оставляет результат пустым без уведомления.
            error={result.data === undefined && !result.loading && page !== null ? 'Не удалось прочитать продажи и возвраты' : undefined}
            emptyText={searched === '' ? 'Продаж и возвратов пока нет' : `Нет продаж и возвратов по запросу «${searched}»`}
        />
    );
}
