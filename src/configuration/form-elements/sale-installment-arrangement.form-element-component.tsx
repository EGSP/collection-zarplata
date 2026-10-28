import { Flex, Tag, Typography } from 'antd';
import { FieldDisplay, RecordLink, Text, useFormData, useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Рассрочка на форме продажи: связанные рассрочки по продаже и неоформленная сумма.
 *
 * Связанные рассрочки — документы «Рассрочка по продаже», которые ссылаются на эту продажу,
 * кроме помеченных на удаление. Они видны у любой записанной продажи при праве их читать:
 * по ним продавец переходит к рассрочке и видит её остаток.
 *
 * Сумма равна итогу регистра «Неоформленные рассрочки» по этой продаже: проведённая продажа
 * записывает в него оплаты способом «Рассрочка», проведённая рассрочка по продаже свою сумму
 * с минусом. Движения есть только у проведённой продажи, поэтому у новой и непроведённой
 * элемент ничего не выводит. Нет его и без права читать регистр: сумму показать нечем.
 *
 * Черновика рассрочки на неоформленную сумму нет: рассрочку создают только с условиями. Такая сумма
 * остаётся у продаж, проведённых до этого правила, и её оформляют через «Внести изменения».
 */
export default function SaleInstallmentArrangement() {
    const sales = Objects.document.sale;
    const form = useFormData(sales);
    const register = useObjectView(Objects.register.unarrangedInstallments);
    const installments = useObjectView(Objects.document.saleInstallment);
    const saved = form.saved;
    if (saved === null) return null;
    return (
        <Flex vertical gap="small">
            {installments !== undefined && <LinkedInstallments sale={saved.guid} />}
            {saved.posted && register !== undefined && <Unarranged sale={saved.guid} />}
        </Flex>
    );
}

/**
 * Связанные рассрочки по продаже: ссылка на документ, тип, сумма и остаток. Закрытая рассрочка
 * отмечена «Закрыта», непроведённая «Черновик»: такая рассрочка долга покупателя ещё не учитывает.
 * Чтение монтируется только при праве читать рассрочки по продаже.
 */
function LinkedInstallments({ sale }: { readonly sale: string }) {
    const installments = Objects.document.saleInstallment;
    const list = useRecordList(installments, {
        permanentFilter: [
            { field: 'sale', operator: 'equals', value: sale },
            { field: 'deletedAt', operator: 'equals', value: null },
        ],
        sort: [{ field: 'date', direction: 'ascending' }],
        pageSize: 50,
    });
    if (list.records.length === 0) return null;
    return (
        <Flex vertical gap={4}>
            {list.records.map((installment) => (
                <Flex key={installment.guid} align="center" gap="middle" wrap>
                    <Typography.Text strong>Рассрочка:</Typography.Text>
                    <RecordLink reference={{ kind: installments.kind, name: installments.name, guid: installment.guid }} />
                    {installment.type !== null && <Typography.Text>{installment.type}</Typography.Text>}
                    <Typography.Text>
                        Сумма <FieldDisplay field={{ kind: 'money', target: null }} value={installment.amount} />
                    </Typography.Text>
                    {/* Остаток — долг покупателя по рассрочке, поэтому сумма окрашена цветом долга. */}
                    <Typography.Text>
                        Остаток <Text tone="debt"><FieldDisplay field={{ kind: 'money', target: null }} value={installment.balance} /></Text>
                    </Typography.Text>
                    {!installment.posted && <Tag>Черновик</Tag>}
                    {installment.closedAt !== null && <Tag color="green">Закрыта</Tag>}
                </Flex>
            ))}
        </Flex>
    );
}

/** Чтение движений монтируется только на форме проведённой продажи при доступном регистре. */
function Unarranged({ sale }: { readonly sale: string }) {
    // Итог складывается из движений по продаже: это движение самой продажи и по одному на каждую
    // её проведённую рассрочку, поэтому хватает одной страницы наибольшего размера.
    const movements = useRecordList(Objects.register.unarrangedInstallments, {
        permanentFilter: [{ field: 'sale', operator: 'equals', value: sale }],
        pageSize: 500,
    });
    const unarranged = movements.records.reduce((total, movement) => total + movement.amount, 0);
    if (unarranged <= 0) return null;
    return (
        <Flex align="center" gap="middle" wrap>
            <Typography.Text strong>
                Не оформлено в рассрочку: <FieldDisplay field={{ kind: 'money', target: null }} value={unarranged} />
            </Typography.Text>
            <Typography.Text type="secondary">Оформите рассрочку с условиями через «Внести изменения».</Typography.Text>
        </Flex>
    );
}
