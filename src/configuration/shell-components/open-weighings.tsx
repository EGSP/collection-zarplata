import { Alert, Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { Icons, ListSearch, spacing, Stack, useFunctionResult, useObjectView, useOpenRecord, useReferencePresentation, type ObjectView } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { documentNumber, goodsLine } from './seller-feed-format';

/** Число товаров с согласованным словом: «1 товар», «2 товара», «5 товаров». */
function goodsCount(count: number): string {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return `${count} товаров`;
    if (last === 1) return `${count} товар`;
    if (last >= 2 && last <= 4) return `${count} товара`;
    return `${count} товаров`;
}

/**
 * Вкладка «Отвесы» на рабочем месте продавца: товары незакрытых отвесов, сгруппированные по
 * покупателям, и поиск по ФИО покупателя. Данные отдаёт функция отвеса `heldGoods`; без права на неё вкладки нет. Проверка
 * стоит здесь, потому что страница рабочего места выводит вкладки сама, без перечня требуемых объектов.
 */
export default function OpenWeighings() {
    return useHeldGoodsAvailable() ? <AvailableWeighings /> : null;
}

/**
 * Доступна ли вкладка: сервер отдаёт в описании объекта только функции, на которые у пользователя
 * есть право, поэтому достаточно найти функцию в описании отвеса.
 */
export function useHeldGoodsAvailable(): boolean {
    return useObjectView(Objects.document.weighing)?.functions.some((declared) => declared.name === 'heldGoods') === true;
}

/**
 * Незакрытые отвесы из функции `heldGoods`, отобранные по части ФИО покупателя. Без поиска блок
 * и подпись вкладки вызывают её с одними входными данными, поэтому кеш запросов отдаёт обоим
 * один ответ. Результат хранится среди ответов о данных и сбрасывается после любого изменяющего
 * действия: проданный из отвеса товар уходит из вкладки без перезагрузки страницы.
 *
 * Прежний результат держится, пока читается новый: при вводе поиска строки не мигают пустотой.
 */
function useHeldGoods(search: string) {
    return useFunctionResult({ object: Objects.document.weighing, name: 'heldGoods', payload: { search }, keepPrevious: true });
}

/**
 * Число незакрытых отвесов для подписи вкладки: число документов, а не товаров, без учёта поиска
 * во вкладке. Вызывать только при доступной функции `heldGoods`.
 */
export function useOpenWeighingCount(): number {
    return useHeldGoods('').data?.rows.length ?? 0;
}

/** Незакрытый отвес из результата `heldGoods`. */
type HeldWeighing = NonNullable<ReturnType<typeof useHeldGoods>['data']>['rows'][number];

/** ФИО физического лица: представление записи справочника. */
function PersonName({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/**
 * Покупатель: строка с ФИО и числом его товаров «В отвесе», под ней товары всех его отвесов
 * в виде «код: название», как в ленте продаж. Строка покупателя сворачивает и раскрывает товары,
 * а строка товара открывает его отвес: у раскрытия и открытия документа разные элементы.
 * Справа у товара стоит номер отвеса: у покупателя бывает несколько отвесов.
 *
 * В отличие от рассрочек, товары раскрыты сразу: продавец смотрит отвесы, чтобы найти товар,
 * а не сумму. Вкладки рабочего места остаются смонтированными после первого показа, поэтому
 * свёрнутый покупатель остаётся свёрнутым при переключении вкладок.
 */
function Customer({ person, weighings, persons }: { readonly person: string; readonly weighings: ReadonlyArray<HeldWeighing>; readonly persons: ObjectView | undefined }) {
    const [expanded, setExpanded] = useState(true);
    const openRecord = useOpenRecord();
    const count = weighings.reduce((sum, row) => sum + row.goods.length, 0);
    const Toggle = expanded ? Icons.collapse : Icons.expand;
    return (
        <Flex vertical>
            {/* Покупатель — крупная кнопка, товары под ним — обычные: выразительный вид ленты
                рабочего места с текстом 16 px и 14 px, как у покупателей и рассрочек во вкладке «Рассрочки». */}
            <Button type="text" size="large" block aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
                {/* Кнопка оборачивает содержимое своим элементом, поэтому строку растягивает внутренний Flex: число стоит у правого края. */}
                <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                    <Flex gap="small" align="center" style={{ minWidth: 0 }}>
                        <Toggle />
                        {/* Без права читать физические лица сервер их описание не отдаёт. */}
                        {/* Размер шрифта берётся у кнопки: свой размер Typography мельче крупной кнопки. */}
                        <Typography.Text ellipsis style={{ minWidth: 0, fontSize: 'inherit' }}>
                            {persons === undefined ? 'Нет доступа' : <PersonName view={persons} guid={person} />}
                        </Typography.Text>
                    </Flex>
                    <Typography.Text type="secondary" style={{ flexShrink: 0, fontSize: 'inherit' }}>{goodsCount(count)}</Typography.Text>
                </Flex>
            </Button>
            {expanded && weighings.flatMap((row) => row.goods.map((line, index) => (
                // Позиции в отвесе могут повторяться, поэтому ключ — отвес и номер товара в нём.
                <Button key={`${row.guid}.${index}`} type="text" block style={{ paddingInlineStart: spacing[7] }}
                    onClick={(event) => void openRecord(Objects.document.weighing, row.guid, 'tab', { original: event.shiftKey })}>
                    <Flex justify="space-between" align="center" gap="small" style={{ width: '100%', minWidth: 0 }}>
                        <Typography.Text ellipsis style={{ minWidth: 0, fontSize: 'inherit' }}>{goodsLine(line)}</Typography.Text>
                        <Typography.Text type="secondary" style={{ flexShrink: 0, fontSize: 'inherit' }}>Отвес № {documentNumber(row.number)}</Typography.Text>
                    </Flex>
                </Button>
            )))}
        </Flex>
    );
}

/**
 * Чтение монтируется только при доступной функции. Отвесы группируются по покупателю в порядке
 * его первого отвеса: функция отдаёт их от старых к новым, и выше стоит тот, кто ждёт дольше.
 * Строка товара открывает отвес; Shift открывает оригинал.
 *
 * Поиск, как во вкладке «Рассрочки», отбирает отвесы на сервере по части ФИО покупателя без учёта
 * регистра. Функция получает текст, уже применённый полем поиска: поле передаёт ввод с задержкой,
 * а очистку сразу.
 */
function AvailableWeighings() {
    const persons = useObjectView(Objects.catalog.physicalPersons);
    const [search, setSearch] = useState('');
    const searched = search.trim();
    const result = useHeldGoods(searched);
    const rows = result.data?.rows ?? [];
    const groups = new Map<string, HeldWeighing[]>();
    for (const row of rows) groups.set(row.person, [...groups.get(row.person) ?? [], row]);
    return (
        // Заголовок блока — вкладка «Отвесы» на рабочем месте, поэтому своей панели у блока нет.
        <Stack gap={3}>
            <ListSearch value={search} onSearch={setSearch} placeholder="Поиск по ФИО покупателя" />
            {/* Отказ, например нехватка права, оставляет результат пустым без уведомления. */}
            {result.data === undefined && !result.loading ? (
                <Alert type="error" showIcon title="Не удалось прочитать отвесы" />
            ) : rows.length === 0 ? (
                <Typography.Text type="secondary">
                    {result.loading ? 'Загрузка…' : searched === '' ? 'Незакрытых отвесов нет' : `Нет покупателей с отвесами по запросу «${searched}»`}
                </Typography.Text>
            ) : (
                <Flex vertical>
                    {[...groups].map(([person, weighings]) => <Customer key={person} person={person} weighings={weighings} persons={persons} />)}
                </Flex>
            )}
        </Stack>
    );
}
