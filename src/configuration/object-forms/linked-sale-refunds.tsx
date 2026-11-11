/**
 * Проведённые возвраты по продаже в её обычном просмотре, под рассрочками. Каждый возврат показан
 * своей присоединённой формой, как рассрочка: заголовок с переходом в возврат, товары и расчёты.
 * Черновики не выводятся: в расчётах они не участвуют. Строки оснований не выводятся: продажа и так открыта.
 */
import { Alert, Button, Flex, Form, Typography } from 'antd';
import { Column, Grid, Icons, TablePart, Text, useActionResult, useObjectView, useOpenRecord, useRecords, type FormTablePart, type TablePartOptions } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { goodsColumnSizes } from './goods-columns';
import { InstallmentDivider } from './linked-installment-form';
import { settlementsOptions } from './refund-settlements';

/** Сохранённые сведения возврата, которые выводит просмотр. */
interface LinkedRefund {
    readonly guid: string;
    readonly number: string;
    readonly date: string;
    readonly goods: ReadonlyArray<{ readonly sale: string }>;
    readonly settlements: ReadonlyArray<{ readonly sale: string }>;
}

/**
 * Товары возврата в просмотре: колонки в порядке и с размерами продажи, сумма строкой «Итого».
 * Колонка продажи скрыта: показаны только товары этой продажи. «Проведено в 1С» тоже скрыто:
 * строка возврата ссылается на товар продажи, а отметку показывает таблица товаров продажи выше.
 */
const goodsOptions: TablePartOptions = {
    fixedRows: true,
    columnSizes: goodsColumnSizes,
    columnOrder: ['code', 'name', 'size', 'cost', 'discount', 'total', 'comment'],
    hiddenColumns: ['sale', 'postedIn1C', 'coupon', 'couponNumber', 'couponPercent', 'couponDenomination'],
    totals: ['total'],
};

/** Расчёты возврата в просмотре: как на форме возврата, без колонки продажи и с итогом. */
const settlementsViewOptions: TablePartOptions = { ...settlementsOptions, fixedRows: true, hiddenColumns: ['sale'], totals: ['amount'] };

/**
 * Расчёты занимают десять колонок, как оплаты продажи и взносы рассрочки: несколько коротких
 * значений, растянутые на всю форму, читаются хуже.
 */
const settlementsSpan = { lg: 10 } as const;

/** Нет чтения возвратов или права на действие: блок не выводится и запросов не делает. */
export function LinkedSaleRefunds({ sale }: { readonly sale: string }) {
    const view = useObjectView(Objects.document.refund);
    const available = view?.form != null && view.form.actions.some((action) => action.name === 'saleRefunds');
    return available ? <RefundsList sale={sale} goods={view.form!.tableParts.find((part) => part.name === 'goods') ?? null} settlements={view.form!.tableParts.find((part) => part.name === 'settlements') ?? null} /> : null;
}

/**
 * Читает возвраты по продаже действием `saleRefunds`, затем их полные данные пакетами get.
 * Оба запроса перечитываются стандартным сбросом SDK после изменения возвратов.
 */
function RefundsList({ sale, goods, settlements }: { readonly sale: string; readonly goods: FormTablePart | null; readonly settlements: FormTablePart | null }) {
    const list = useActionResult<ReadonlyArray<{ readonly guid: string }>>({ object: Objects.document.refund, action: 'saleRefunds', payload: { sale } });
    const records = useRecords(Objects.document.refund, list.data?.map((item) => item.guid) ?? []);
    if (records.error !== null) return <Alert type="error" showIcon title="Не удалось прочитать возвраты" description={records.error.message} />;
    if (list.data === undefined) return list.loading ? <Typography.Text type="secondary">Загрузка возвратов…</Typography.Text> : <Alert type="error" title="Не удалось прочитать возвраты" />;
    return <>
        {list.data.map(({ guid }) => {
            const refund = records.records.get(guid) as LinkedRefund | undefined;
            return refund === undefined ? null : <RefundView key={guid} refund={refund} sale={sale} goods={goods} settlements={settlements} />;
        })}
    </>;
}

/** Заголовок присоединённой формы возврата. */
const refundTitle = (refund: LinkedRefund) => `Возврат № ${refund.number} от ${new Date(refund.date).toLocaleDateString('ru-RU')}`;

/**
 * Присоединённая форма возврата: товары и расчёты этой продажи только для чтения. Таблицам нужна
 * своя форма без HTML form: строки не принадлежат продаже. Новая версия данных задаётся ключом.
 */
function RefundView({ refund, sale, goods, settlements }: { readonly refund: LinkedRefund; readonly sale: string; readonly goods: FormTablePart | null; readonly settlements: FormTablePart | null }) {
    const openRecord = useOpenRecord();
    const values = {
        goods: refund.goods.filter((line) => line.sale === sale),
        settlements: refund.settlements.filter((line) => line.sale === sale),
    };
    return <section aria-label={refundTitle(refund)}>
        <InstallmentDivider />
        <Flex vertical gap="middle">
            <Flex align="center" gap="middle" wrap>
                <Text.Heading variant="03">{refundTitle(refund)}</Text.Heading>
                {/* Продажа в просмотре недоступна для изменения, и форма отключает все кнопки внутри.
                    Переход только открывает возврат, поэтому кнопка включена явно, как у рассрочки. */}
                <Button type="text" disabled={false} icon={<Icons.open />} aria-label="Открыть возврат" title="Открыть возврат"
                    onClick={() => void openRecord(Objects.document.refund, refund.guid, 'tab', { original: true })} />
            </Flex>
            <Form key={JSON.stringify(values)} component={false} disabled initialValues={values}>
                <Flex vertical gap="middle">
                    {goods !== null && <TablePart part={goods} disabled {...goodsOptions} />}
                    {settlements !== null && values.settlements.length > 0 && (
                        <Grid><Column span={settlementsSpan}><TablePart part={settlements} disabled {...settlementsViewOptions} /></Column></Grid>
                    )}
                </Flex>
            </Form>
        </Flex>
    </section>;
}
