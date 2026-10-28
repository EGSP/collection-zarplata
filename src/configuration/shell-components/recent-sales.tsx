import { Alert, Button, Typography } from 'antd';
import { FieldDisplay, Panel, spacing, Text, useObjectView, useOpenRecord, useRecordList, useRecords } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Число продаж в фиде: экран показывает последние операции, а не полный список. */
const feedSize = 10;

/** Формат времени продажи сегодняшнего дня: продавцу нужна только минута операции. */
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });

/** Формат времени продажи прошлых дней: без даты строки разных дней были бы неотличимы. */
const dayTimeFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Краткое время продажи: сегодня только часы и минуты, в другие дни ещё день и месяц. */
function shortTime(value: string): string {
    const date = new Date(value);
    return (date.toDateString() === new Date().toDateString() ? timeFormat : dayTimeFormat).format(date);
}

/**
 * Блок «Последние продажи» на рабочем месте продавца: компактный фид последних проведённых продаж,
 * новые сверху. Стоит в информационном блоке рядом с рассрочками по продажам и отвесами.
 * Без права читать продажи блока нет: проверка стоит здесь, потому что страница рабочего места
 * выводит блок сама, без перечня требуемых объектов.
 */
export default function RecentSales() {
    const view = useObjectView(Objects.document.sale);
    return view === undefined ? null : <AvailableSales />;
}

/**
 * Чтение монтируется только при доступном описании объекта.
 *
 * В строке время, способ оплаты, названия товаров через запятую и сумма. Названия занимают
 * оставшуюся ширину строки и обрезаются многоточием, если не помещаются; полный перечень виден
 * в подсказке. Список не отдаёт строки табличных частей, поэтому товары продаж фида дочитываются
 * одним пакетом через `useRecords`; до ответа на месте названий пусто. Нажатие открывает продажу во вкладке. Перечитывать
 * фид не нужно: запись продажи помечает сохранённые ответы сервера устаревшими, и список
 * обновляется сам.
 */
function AvailableSales() {
    const sales = Objects.document.sale;
    const openRecord = useOpenRecord();
    // Фид показывает только оформленные продажи: черновики и помеченные на удаление в него не входят.
    const list = useRecordList(sales, {
        permanentFilter: [
            { field: 'posted', operator: 'equals', value: true },
            { field: 'deletedAt', operator: 'equals', value: null },
        ],
        sort: [{ field: 'date', direction: 'descending' }],
        pageSize: feedSize,
    });
    const details = useRecords(sales, list.records.map((sale) => sale.guid));
    return (
        // Ширину карточки задаёт колонка страницы; товары, не поместившиеся в строку, обрезаются многоточием.
        <Panel title="Последние продажи">
            {list.error !== null ? (
                <Alert type="error" showIcon title="Не удалось прочитать продажи" description={list.error.message} />
            ) : list.records.length === 0 ? (
                <Typography.Text type="secondary">{list.loading ? 'Загрузка…' : 'Продаж пока нет'}</Typography.Text>
            ) : (
                // Строки — кнопки на общей сетке из четырёх колонок: время, способ оплаты, товары, сумма.
                // Кнопка продолжает колонки списка (subgrid), поэтому колонки всех строк стоят ровно
                // по самому длинному значению без заданной ширины; товары получают оставшееся место.
                <div style={{ display: 'grid', gridTemplateColumns: 'max-content max-content minmax(0, 1fr) max-content', columnGap: spacing[5] }}>
                    {list.records.map((sale) => {
                        const goods = details.records.get(sale.guid)?.goods.map((line) => line.name).join(', ') ?? '';
                        return (
                            <Button key={sale.guid} type="text" size="small" block onClick={() => void openRecord(sales, sale.guid)}
                                style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: 'subgrid', alignItems: 'center', textAlign: 'left' }}>
                                <Text tone="secondary" noWrap>{shortTime(sale.date)}</Text>
                                <Text noWrap>{sale.paymentMode}</Text>
                                <Text tone="secondary" ellipsis>{goods}</Text>
                                {/* Сумма прижата к правому краю колонки: разряды сумм разных строк стоят друг под другом. */}
                                <span style={{ justifySelf: 'end' }}><FieldDisplay field={{ kind: 'money', target: null }} value={sale.amount} /></span>
                            </Button>
                        );
                    })}
                </div>
            )}
        </Panel>
    );
}
