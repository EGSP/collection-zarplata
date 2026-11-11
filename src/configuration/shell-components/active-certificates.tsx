import { Alert, Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { FieldDisplay, Icons, ListSearch, spacing, Stack, useFunctionResult, useObjectView, useOpenRecord, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { documentNumber } from './seller-feed-format';

/**
 * Вкладка «Сертификаты» на рабочем месте продавца: действующие сертификаты (остаток больше нуля),
 * сгруппированные по держателям, и поиск по ФИО, как во вкладках «Рассрочки» и «Отвесы».
 * Данные отдаёт функция сертификата `activeCertificates`; без права на неё вкладки нет.
 */
export default function ActiveCertificates() {
    return useActiveCertificatesAvailable() ? <AvailableCertificates /> : null;
}

/**
 * Доступна ли вкладка: сервер отдаёт в описании объекта только функции, на которые у пользователя
 * есть право, поэтому достаточно найти функцию в описании сертификата.
 */
export function useActiveCertificatesAvailable(): boolean {
    return useObjectView(Objects.document.certificate)?.functions.some((declared) => declared.name === 'activeCertificates') === true;
}

/**
 * Действующие сертификаты из функции `activeCertificates`, отобранные по части ФИО держателя.
 * Без поиска блок и подпись вкладки вызывают её с одними входными данными и получают один ответ
 * из кеша. Результат сбрасывается после любого изменяющего действия: израсходованный в продаже
 * сертификат уходит из вкладки без перезагрузки страницы. Прежний результат держится, пока
 * читается новый, поэтому при вводе поиска строки не мигают пустотой.
 */
function useActiveCertificates(search: string) {
    return useFunctionResult({ object: Objects.document.certificate, name: 'activeCertificates', payload: { search }, keepPrevious: true });
}

/** Общий остаток действующих сертификатов для подписи вкладки, без учёта поиска во вкладке. */
export function useActiveCertificatesBalance(): number {
    return (useActiveCertificates('').data?.rows ?? []).reduce((sum, row) => sum + row.balance, 0);
}

/** Действующий сертификат из результата `activeCertificates`. */
type ActiveCertificate = NonNullable<ReturnType<typeof useActiveCertificates>['data']>['rows'][number];

/** ФИО физического лица: представление записи справочника. */
function PersonName({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/** Держатель сертификата: физическое лицо из справочника или ФИО строкой. */
type CertificateHolder = ActiveCertificate['holder'];

/**
 * Ключ группы держателя. Физическое лицо группируется по своей записи. Держатели-строки
 * группируются по тексту без учёта регистра и пробелов по краям: «Иванова Анна» и « иванова анна»
 * набраны для одного человека. Приставка разводит строки и физических лиц: строка с тем же ФИО,
 * что у записи справочника, остаётся отдельной группой, потому что связи с записью у неё нет.
 */
function holderKey(holder: CertificateHolder): string {
    return holder.type === 'reference' ? `person:${holder.guid}` : `text:${holder.value.trim().toLocaleLowerCase('ru')}`;
}

/** ФИО держателя: у физического лица его представление, у строки сам текст. */
function HolderName({ holder, persons }: { readonly holder: CertificateHolder; readonly persons: ObjectView | undefined }) {
    if (holder.type !== 'reference') return <>{holder.value.trim()}</>;
    // Без права читать физические лица сервер их описание не отдаёт.
    return persons === undefined ? <>Нет доступа</> : <PersonName view={persons} guid={holder.guid} />;
}

/** Сумма в рублях в том же виде, что в полях форм. */
function Money({ value }: { readonly value: number }) {
    return <FieldDisplay field={{ kind: 'money', target: null }} value={value} />;
}

/**
 * Держатель: строка с ФИО и общим остатком его сертификатов, под ней сертификаты с номером,
 * номиналом и остатком. Строка держателя сворачивает и раскрывает сертификаты, строка сертификата
 * открывает его карточку; Shift открывает оригинал. Сертификаты раскрыты сразу: продавец ищет
 * сертификат покупателя, чтобы оплатить им продажу.
 */
function Holder({ holder, certificates, persons }: { readonly holder: CertificateHolder; readonly certificates: ReadonlyArray<ActiveCertificate>; readonly persons: ObjectView | undefined }) {
    const [expanded, setExpanded] = useState(true);
    const openRecord = useOpenRecord();
    const balance = certificates.reduce((sum, row) => sum + row.balance, 0);
    const Toggle = expanded ? Icons.collapse : Icons.expand;
    return (
        <Flex vertical>
            <Button type="text" size="large" block aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {/* Кнопка оборачивает содержимое своим элементом, поэтому строку растягивает внутренний Flex: сумма стоит у правого края. */}
                <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                    <Flex gap="small" align="center" style={{ minWidth: 0 }}>
                        <Toggle />
                        <Typography.Text ellipsis style={{ minWidth: 0, fontSize: 'inherit' }}>
                            <HolderName holder={holder} persons={persons} />
                        </Typography.Text>
                    </Flex>
                    <Typography.Text type="secondary" style={{ flexShrink: 0, fontSize: 'inherit' }}><Money value={balance} /></Typography.Text>
                </Flex>
            </Button>
            {expanded && certificates.map((row) => (
                <Button key={row.guid} type="text" block style={{ paddingInlineStart: spacing[7] }}
                    onClick={(event) => void openRecord(Objects.document.certificate, row.guid, 'tab', { original: event.shiftKey })}>
                    <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                        <Flex gap="small" align="center" style={{ minWidth: 0 }}>
                            <Icons.certificate />
                            <Typography.Text ellipsis style={{ minWidth: 0, fontSize: 'inherit' }}>
                                Сертификат № {documentNumber(row.number)} на <Money value={row.denomination} />
                            </Typography.Text>
                        </Flex>
                        <Typography.Text type="secondary" style={{ flexShrink: 0, fontSize: 'inherit' }}>Остаток <Money value={row.balance} /></Typography.Text>
                    </Flex>
                </Button>
            ))}
        </Flex>
    );
}

/**
 * Чтение монтируется только при доступной функции. Сертификаты группируются по держателю в порядке
 * его первого сертификата: функция отдаёт их от старых к новым. Поиск отбирает их на сервере по
 * части ФИО без учёта регистра; поле поиска передаёт ввод с задержкой, а очистку сразу.
 */
function AvailableCertificates() {
    const persons = useObjectView(Objects.catalog.physicalPersons);
    const [search, setSearch] = useState('');
    const searched = search.trim();
    const result = useActiveCertificates(searched);
    const rows = result.data?.rows ?? [];
    const groups = new Map<string, ActiveCertificate[]>();
    for (const row of rows) groups.set(holderKey(row.holder), [...groups.get(holderKey(row.holder)) ?? [], row]);
    return (
        // Заголовок блока — вкладка «Сертификаты» на рабочем месте, поэтому своей панели у блока нет.
        <Stack gap={3}>
            <ListSearch value={search} onSearch={setSearch} placeholder="Поиск по ФИО держателя" />
            {/* Отказ, например нехватка права, оставляет результат пустым без уведомления. */}
            {result.data === undefined && !result.loading ? (
                <Alert type="error" showIcon title="Не удалось прочитать сертификаты" />
            ) : rows.length === 0 ? (
                <Typography.Text type="secondary">
                    {result.loading ? 'Загрузка…' : searched === '' ? 'Действующих сертификатов нет' : `Нет держателей сертификатов по запросу «${searched}»`}
                </Typography.Text>
            ) : (
                <Flex vertical>
                    {/* Группа держателя-строки называется текстом его первого сертификата. */}
                    {[...groups].map(([key, certificates]) => <Holder key={key} holder={certificates[0]!.holder} certificates={certificates} persons={persons} />)}
                </Flex>
            )}
        </Stack>
    );
}
