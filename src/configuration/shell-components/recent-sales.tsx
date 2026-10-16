import { Alert, Button, Card, Flex, Typography } from 'antd';
import { FieldDisplay, useObjectView, useOpenRecord, useRecordList, useRecords } from '../../web/sdk';
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
        <Card size="small" title="Последние продажи" style={{ flex: 2, minWidth: 280 }}>
            {list.error !== null ? (
                <Alert type="error" showIcon title="Не удалось прочитать продажи" description={list.error.message} />
            ) : list.records.length === 0 ? (
                <Typography.Text type="secondary">{list.loading ? 'Загрузка…' : 'Продаж пока нет'}</Typography.Text>
            ) : (
                <Flex vertical>
                    {list.records.map((sale) => {
                        const goods = details.records.get(sale.guid)?.goods.map((line) => line.name).join(', ') ?? '';
                        return (
                            <Button key={sale.guid} type="text" size="small" block onClick={() => void openRecord(sales, sale.guid)}>
                                <Flex gap="middle" align="center" style={{ width: '100%', minWidth: 0 }}>
                                    {/* Время и способ оплаты не уже самого длинного значения: колонки строк стоят ровно. */}
                                    <Typography.Text type="secondary" style={{ flexShrink: 0, minWidth: 88, textAlign: 'left' }}>
                                        {shortTime(sale.date)}
                                    </Typography.Text>
                                    <Typography.Text style={{ flexShrink: 0, minWidth: 88, textAlign: 'left' }}>{sale.paymentMode}</Typography.Text>
                                    {/* Нулевая минимальная ширина позволяет тексту сжиматься внутри Flex и обрезаться многоточием. */}
                                    <Typography.Text type="secondary" ellipsis={{ tooltip: goods }} style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                                        {goods}
                                    </Typography.Text>
                                    <span style={{ flexShrink: 0 }}>
                                        <FieldDisplay field={{ kind: 'money', target: null }} value={sale.amount} />
                                    </span>
                                </Flex>
                            </Button>
                        );
                    })}
                </Flex>
            )}
        </Card>
    );
}
