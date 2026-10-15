import { useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { DebtList } from './debt-list';

/**
 * Блок «Рассрочки по продажам» на рабочем месте продавца: проведённые незакрытые рассрочки
 * с ФИО покупателя и остатком. Без права читать рассрочки блока нет: проверка стоит здесь,
 * потому что страница рабочего места выводит блок сама, без перечня требуемых объектов.
 */
export default function OpenSaleInstallments() {
    const view = useObjectView(Objects.document.saleInstallment);
    return view === undefined ? null : <AvailableSaleInstallments />;
}

/** Чтение монтируется только при доступном описании объекта. */
function AvailableSaleInstallments() {
    // Незакрытой считается рассрочка без даты закрытия; помеченная на удаление в блок не входит.
    // Непроведённая тоже не входит: это черновик, долга по ней в регистре расчётов ещё нет.
    const list = useRecordList(Objects.document.saleInstallment, {
        permanentFilter: [
            { field: 'closedAt', operator: 'equals', value: null },
            { field: 'deletedAt', operator: 'equals', value: null },
            { field: 'posted', operator: 'equals', value: true },
        ],
        sort: [{ field: 'date', direction: 'ascending' }],
        pageSize: 100,
    });
    return <DebtList title="Рассрочки по продажам" object={Objects.document.saleInstallment} rows={list.records} total={list.total} loading={list.loading} error={list.error} empty="Незакрытых рассрочек по продажам нет" />;
}
