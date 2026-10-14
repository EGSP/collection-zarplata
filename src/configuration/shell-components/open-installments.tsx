import { useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { DebtList } from './debt-list';

/** Документ рассрочки: «Рассрочка» или «Рассрочка по продаже». */
type InstallmentObject = typeof Objects.document.installment | typeof Objects.document.saleInstallment;

/** Свойства блока незакрытых рассрочек одного вида. */
export interface InstallmentDebtsProperties {
    readonly object: InstallmentObject;
    readonly title: string;
    /** Текст на месте строк, когда незакрытых рассрочек нет. */
    readonly empty: string;
}

/**
 * Блок незакрытых рассрочек одного вида: проведённые незакрытые документы с ФИО покупателя
 * и остатком. Общая часть блоков «Рассрочки» и «Рассрочки по продажам»: поля и условие
 * незакрытой рассрочки у двух документов одинаковы. Без права читать документ блока нет:
 * проверка стоит здесь, потому что страница рабочего места выводит блок сама, без перечня
 * требуемых объектов.
 */
export function InstallmentDebts(properties: InstallmentDebtsProperties) {
    const view = useObjectView(properties.object);
    return view === undefined ? null : <AvailableInstallments {...properties} />;
}

/** Чтение монтируется только при доступном описании объекта. */
function AvailableInstallments({ object, title, empty }: InstallmentDebtsProperties) {
    // Незакрытой считается рассрочка без даты закрытия; помеченная на удаление в блок не входит.
    // Непроведённая тоже не входит: это черновик, долга по ней в регистре расчётов ещё нет.
    // Отбор читает только общие поля двух документов, поэтому список типизирован обычной рассрочкой.
    const list = useRecordList(object as typeof Objects.document.installment, {
        permanentFilter: [
            { field: 'closedAt', operator: 'equals', value: null },
            { field: 'deletedAt', operator: 'equals', value: null },
            { field: 'posted', operator: 'equals', value: true },
        ],
        sort: [{ field: 'date', direction: 'ascending' }],
        pageSize: 100,
    });
    return <DebtList title={title} object={object} rows={list.records} total={list.total} loading={list.loading} error={list.error} empty={empty} />;
}

/** Блок «Рассрочки» на рабочем месте продавца. */
export default function OpenInstallments() {
    return <InstallmentDebts object={Objects.document.installment} title="Рассрочки" empty="Незакрытых рассрочек нет" />;
}
