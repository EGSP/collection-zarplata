import { Button, Flex, Tag, Typography } from 'antd';
import { useState } from 'react';
import { FieldDisplay, RecordLink, useFormData, useFormRestrictions, useObjectView, useOpenRecord, useRecordList, type FormAction } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Рассрочка на форме продажи: связанные рассрочки по продаже, неоформленная сумма и кнопка
 * «Оформить рассрочку».
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
 * Стандартная кнопка действия скрыта: её окно потребовало бы выбрать продажу, а элемент передаёт
 * `guid` открытой записи сам.
 */
export default function SaleInstallmentArrangement() {
    const sales = Objects.document.sale;
    const form = useFormData(sales);
    const register = useObjectView(Objects.register.unarrangedInstallments);
    useFormRestrictions(sales, { hiddenActions: ['createInstallment'] });
    const installments = useObjectView(Objects.document.saleInstallment);
    const saved = form.saved;
    if (saved === null) return null;
    return (
        <Flex vertical gap="small">
            {installments !== undefined && <LinkedInstallments sale={saved.guid} />}
            {saved.posted && register !== undefined && (
                <Unarranged
                    sale={saved.guid}
                    action={form.view.actions.find((action) => action.name === 'createInstallment')}
                    run={() => form.runAction('createInstallment', { sale: saved.guid })}
                />
            )}
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
                    <Typography.Text>
                        Остаток <FieldDisplay field={{ kind: 'money', target: null }} value={installment.balance} />
                    </Typography.Text>
                    {!installment.posted && <Tag style={{ marginInlineEnd: 0 }}>Черновик</Tag>}
                    {installment.closedAt !== null && <Tag color="green" style={{ marginInlineEnd: 0 }}>Закрыта</Tag>}
                </Flex>
            ))}
        </Flex>
    );
}

/** Свойства чтения неоформленной суммы. */
interface UnarrangedProperties {
    readonly sale: string;
    /** Действие «Оформить рассрочку»; без права на него действия в описании формы нет. */
    readonly action: FormAction | undefined;
    /** Выполняет действие через форму: перед ним она записывает несохранённые изменения. */
    readonly run: () => Promise<unknown>;
}

/** Чтение движений монтируется только на форме проведённой продажи при доступном регистре. */
function Unarranged({ sale, action, run }: UnarrangedProperties) {
    const openRecord = useOpenRecord();
    const [creating, setCreating] = useState(false);
    // Итог складывается из движений по продаже: это движение самой продажи и по одному на каждую
    // её проведённую рассрочку, поэтому хватает одной страницы наибольшего размера.
    const movements = useRecordList(Objects.register.unarrangedInstallments, {
        permanentFilter: [{ field: 'sale', operator: 'equals', value: sale }],
        pageSize: 500,
    });
    const unarranged = movements.records.reduce((total, movement) => total + movement.amount, 0);
    if (unarranged <= 0) return null;

    const create = async () => {
        setCreating(true);
        try {
            const installment = (await run()) as { readonly guid: string };
            await openRecord(Objects.document.saleInstallment, installment.guid);
        } catch {
            // Об отказе уже сообщило уведомление с текстом сервера.
        } finally {
            setCreating(false);
        }
    };
    return (
        <Flex align="center" gap="middle" wrap>
            <Typography.Text strong>
                Не оформлено в рассрочку: <FieldDisplay field={{ kind: 'money', target: null }} value={unarranged} />
            </Typography.Text>
            {action !== undefined && <Button loading={creating} onClick={() => void create()}>{action.title}</Button>}
        </Flex>
    );
}
