import { Button, Flex, Typography } from 'antd';
import { useState } from 'react';
import { FieldDisplay, useFormData, useFormRestrictions, useObjectView, useOpenRecord, useRecordList, type FormAction } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Неоформленная сумма рассрочки на форме продажи и кнопка «Оформить рассрочку».
 *
 * Сумма равна итогу регистра «Рассрочки по продажам» по этой продаже: проведённая продажа
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
    const register = useObjectView(Objects.register.saleInstallments);
    useFormRestrictions(sales, { hiddenActions: ['createInstallment'] });
    const saved = form.saved;
    if (saved === null || !saved.posted || register === undefined) return null;
    return (
        <Unarranged
            sale={saved.guid}
            action={form.view.actions.find((action) => action.name === 'createInstallment')}
            run={() => form.runAction('createInstallment', { sale: saved.guid })}
        />
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
    const movements = useRecordList(Objects.register.saleInstallments, {
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
