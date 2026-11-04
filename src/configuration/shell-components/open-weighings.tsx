import { Typography } from 'antd';
import { useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { DebtList } from './debt-list';

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
 * Незакрытые отвесы: отвес не закрыт, пока в нём есть товары «В отвесе», их число хранит
 * вычисляемое поле шапки. Условия общие у блока и подписи вкладки, поэтому кеш запросов
 * отдаёт обоим один ответ.
 */
const openWeighings = {
    permanentFilter: [
        { field: 'heldCount', operator: 'greater', value: 0 },
        { field: 'deletedAt', operator: 'equals', value: null },
    ],
    sort: [{ field: 'date', direction: 'ascending' }],
    pageSize: 100,
} as const;

/**
 * Вкладка «Отвесы» на рабочем месте продавца: незакрытые отвесы с ФИО покупателя и числом его
 * товаров «В отвесе». Считаются товары, а не документы: в одном отвесе бывает несколько товаров,
 * и часть из них уже продана или вывешена. Остаток не выводится: стоимость товаров отвеса
 * не вводится, её заполняют в продаже.
 *
 * Без права читать отвесы вкладки нет: проверка стоит здесь, потому что страница рабочего места
 * выводит вкладки сама, без перечня требуемых объектов.
 */
export default function OpenWeighings() {
    const view = useObjectView(Objects.document.weighing);
    return view === undefined ? null : <AvailableWeighings />;
}

/**
 * Число незакрытых отвесов для подписи вкладки: число документов на всех страницах, а не товаров.
 * Вызывать только при доступном описании отвесов.
 */
export function useOpenWeighingCount(): number {
    return useRecordList(Objects.document.weighing, openWeighings).total;
}

/** Чтение монтируется только при доступном описании объекта. */
function AvailableWeighings() {
    const list = useRecordList(Objects.document.weighing, openWeighings);
    return <DebtList object={Objects.document.weighing} rows={list.records} total={list.total} loading={list.loading} error={list.error} empty="Незакрытых отвесов нет"
        value={(row) => <Typography.Text type="secondary" style={{ fontSize: 'inherit' }}>{goodsCount(row.heldCount)}</Typography.Text>} />;
}
