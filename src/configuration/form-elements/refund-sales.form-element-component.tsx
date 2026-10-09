import { Collapse, Typography } from 'antd';
import type { RecordOf } from '../../server/metadata/index';
import { RecordTablePart, useFormData, useFormValue, useObjectView, useReferencePresentation, type ObjectView } from '../../web/sdk';
import type { Sale } from '../documents/sale.document';
import { Objects } from '../objects.generated';

/** Заголовок раскрываемого блока: представление продажи, как в поле ссылки на неё. */
function SaleTitle({ view, guid }: { readonly view: ObjectView; readonly guid: string }) {
    return <>{useReferencePresentation(view, guid).text}</>;
}

/**
 * Товары продаж-оснований на форме возврата. Каждая продажа из части «На основании» показана
 * раскрываемым блоком с её товарами; нажатие на товар добавляет его копию в товары возврата
 * со ссылкой на продажу. Сама продажа при этом не читается для изменения и не меняется.
 *
 * Товар копируется вместе со стоимостью и скидкой, а итог форма пересчитывает сама. Один товар
 * можно добавить несколько раз и затем исправить стоимость: предел возврата действует на сумму
 * по продаже, а не на отдельные товары, и проверяется при проведении.
 *
 * Продажи элемент читает из значений формы, поэтому блок появляется сразу после выбора продажи
 * в строке основания, до записи. На форме только для просмотра нажатие ничего не добавляет.
 */
export default function RefundSales() {
    const refunds = Objects.document.refund;
    const form = useFormData(refunds);
    const bases = useFormValue(refunds, 'bases');
    const view = useObjectView(Objects.document.sale);
    // Без права читать продажи их товары не показать; строки основания при этом выводят «Нет доступа».
    if (view === undefined) return null;
    const sales = [...new Set(bases.flatMap((line) => line.sale === null ? [] : [line.sale]))];
    if (sales.length === 0) {
        return <Typography.Text type="secondary">Выберите продажу в строке основания: её товары появятся здесь</Typography.Text>;
    }
    return (
        <Collapse
            size="small"
            items={sales.map((guid) => ({
                key: guid,
                label: <SaleTitle view={view} guid={guid} />,
                children: (
                    <RecordTablePart
                        object={Objects.document.sale}
                        guid={guid}
                        part="goods"
                        onRowClick={form.readOnly ? undefined : (row) => {
                            const line = row as RecordOf<typeof Sale>['goods'][number];
                            // Строки вычисляются от текущего значения формы: при быстрых нажатиях подряд
                            // второе нажатие по строкам прошлой отрисовки отменило бы первое.
                            form.setValue('goods', (current) => [...current, { name: line.name, cost: line.cost, discount: line.discount, total: line.total, sale: guid }]);
                        }}
                    />
                ),
            }))}
        />
    );
}
