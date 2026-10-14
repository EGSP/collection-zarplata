import { Button, Card, Flex } from 'antd';
import { useNavigate } from 'react-router';
import { Icons, objectPath, Page, useObjectView, useOpenRecord, type PerformTarget } from '../../web/sdk';
import { Objects } from '../objects.generated';
import OpenInstallments from '../shell-components/open-installments';
import OpenSaleInstallments from '../shell-components/open-sale-installments';
import OpenWeighings from '../shell-components/open-weighings';

/**
 * Столбец документа: создание документа и переход к его списку. Кнопки создания нет у пользователя
 * без права записи: сервер оставляет действие `save` в описании формы только при этом праве.
 * Нет её и у документа с `creation={false}`: такой документ создаёт действие другого документа.
 * Без права чтения документа нет всего столбца.
 */
function DocumentColumn({ title, object, creation = true }: { readonly title: string; readonly object: PerformTarget; readonly creation?: boolean }) {
    const view = useObjectView(object);
    const openRecord = useOpenRecord();
    const navigate = useNavigate();
    if (view === undefined) return null;
    const creatable = creation && view.form?.actions.some((action) => action.name === 'save') === true;
    return (
        <Card size="small" title={title} style={{ flex: 1, minWidth: 180 }}>
            <Flex vertical gap="small">
                {creatable && (
                    <Button type="primary" icon={<Icons.add />} onClick={() => void openRecord(object, null)}>
                        Создать
                    </Button>
                )}
                {/* Список открывается вкладкой: вкладку определяет адрес, и переход по нему её открывает. */}
                <Button icon={<Icons.open />} onClick={() => void navigate(objectPath(object))}>
                    Список
                </Button>
            </Flex>
        </Card>
    );
}

/**
 * Рабочее место продавца: документы продаж на одном экране. В шапке столбцы, по одному
 * на документ, под ними блоки незакрытых рассрочек и отвесов.
 * Рассрочка по продаже показана только списком: её оформляют из продажи.
 *
 * Это первая редакция экрана: он служит макетом, по которому уточняются требования. Поэтому
 * страница только открывает стандартные формы и списки и собственных форм документов не содержит.
 */
export default function SellerWorkplacePage() {
    return (
        <Page title="Рабочее место продавца">
            <Flex gap="middle" wrap>
                <DocumentColumn title="Продажа" object={Objects.document.sale} />
                <DocumentColumn title="Отвес" object={Objects.document.weighing} />
                <DocumentColumn title="Возврат" object={Objects.document.refund} />
                <DocumentColumn title="Рассрочка" object={Objects.document.installment} />
                <DocumentColumn title="Рассрочка по продаже" object={Objects.document.saleInstallment} creation={false} />
            </Flex>
            <Flex gap="middle" align="flex-start" wrap>
                <OpenInstallments />
                <OpenSaleInstallments />
                <OpenWeighings />
            </Flex>
        </Page>
    );
}
