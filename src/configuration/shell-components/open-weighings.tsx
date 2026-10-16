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
 * Блок «Отвесы» на рабочем месте продавца: незакрытые отвесы с ФИО покупателя и числом его товаров
 * «В отвесе», а в заголовке число таких товаров во всех отвесах. Считаются товары, а не документы:
 * в одном отвесе бывает несколько товаров, и часть из них уже продана или вывешена. Остаток
 * не выводится: стоимость товаров отвеса не вводится, её заполняют в продаже.
 *
 * Без права читать отвесы блока нет: проверка стоит здесь, потому что страница рабочего места
 * выводит блок сама, без перечня требуемых объектов.
 */
export default function OpenWeighings() {
    const view = useObjectView(Objects.document.weighing);
    return view === undefined ? null : <AvailableWeighings />;
}

/** Чтение монтируется только при доступном описании объекта. */
function AvailableWeighings() {
    const weighings = Objects.document.weighing;
    // Отвес не закрыт, пока в нём есть товары «В отвесе»; их число хранит вычисляемое поле шапки.
    const list = useRecordList(weighings, {
        permanentFilter: [
            { field: 'heldCount', operator: 'greater', value: 0 },
            { field: 'deletedAt', operator: 'equals', value: null },
        ],
        sort: [{ field: 'date', direction: 'ascending' }],
        pageSize: 100,
    });
    // Итог складывается по прочитанной странице. Если отвесов больше страницы, итог неполный,
    // и заголовок говорит «не меньше»: точную сумму по всем отвесам клиент без запроса итогов не знает.
    const held = list.records.reduce((sum, row) => sum + row.heldCount, 0);
    const partial = list.total > list.records.length;
    const title = (
        <>
            Отвесы{held > 0 && <Typography.Text type="secondary"> {partial ? 'не меньше ' : ''}{goodsCount(held)}</Typography.Text>}
        </>
    );
    return <DebtList title={title} object={weighings} rows={list.records} total={list.total} loading={list.loading} error={list.error} empty="Незакрытых отвесов нет"
        value={(row) => <Typography.Text type="secondary">{goodsCount(row.heldCount)}</Typography.Text>} />;
}
