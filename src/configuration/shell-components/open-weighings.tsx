import { useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { DebtList } from './debt-list';

/**
 * Блок «Отвесы» на главном экране и на рабочем месте продавца: незакрытые отвесы с ФИО покупателя
 * и остатком. Без права читать отвесы блока нет: проверка стоит здесь, потому что страница
 * рабочего места выводит блок сама, без перечня требуемых объектов.
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
    return <DebtList title="Отвесы" object={weighings} rows={list.records} total={list.total} loading={list.loading} error={list.error} empty="Незакрытых отвесов нет" />;
}
