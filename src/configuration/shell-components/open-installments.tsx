import { useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { DebtList } from './debt-list';

/**
 * Блок «Рассрочки» на главном экране и на рабочем месте продавца: незакрытые рассрочки с ФИО
 * покупателя и остатком. Без права читать рассрочки блока нет: проверка стоит здесь, потому что
 * страница рабочего места выводит блок сама, без перечня требуемых объектов.
 */
export default function OpenInstallments() {
    const view = useObjectView(Objects.document.installment);
    return view === undefined ? null : <AvailableInstallments />;
}

/** Чтение монтируется только при доступном описании объекта. */
function AvailableInstallments() {
    const installments = Objects.document.installment;
    // Незакрытой считается рассрочка без даты закрытия; помеченная на удаление в блок не входит.
    const list = useRecordList(installments, {
        permanentFilter: [
            { field: 'closedAt', operator: 'equals', value: null },
            { field: 'deletedAt', operator: 'equals', value: null },
        ],
        sort: [{ field: 'date', direction: 'ascending' }],
        pageSize: 100,
    });
    return <DebtList title="Рассрочки" object={installments} rows={list.records} total={list.total} loading={list.loading} error={list.error} empty="Незакрытых рассрочек нет" />;
}
