import { Button, Card, Divider, Flex, Form } from 'antd';
import { useState } from 'react';
import { PostedIn1CSwitch } from './posted-in-1c-switch';
import { emptyInstallmentTerms, installmentTermsProblems, SaleInstallmentBlock, type SaleInstallmentTerms } from './sale-installment-block';
import { FieldGroup, Icons, recordFormElements, RecordFormPage, useRecordForm, type FormElementReference, type NewFormProperties, type FormValues, type RecordFormButtons, type RecordFormOptions, type RecordFormProperties, type RecordFormState, type TablePartOptions } from '../../web/sdk';

/**
 * Вид таблицы товаров. Код и стоимость короткие, поэтому их колонки вдвое уже, чем досталось бы
 * им в общей раскладке. Остаток ширины делят название и комментарий: названию треть, комментарию
 * две трети, потому что название товара короче комментария к нему. Комментарий стоит последним:
 * его заполняют реже остальных колонок, и при вводе строки он не прерывает путь от названия
 * к стоимости. «Проведено в 1С» выбирается переключателем «Да» / «Нет». Сумма продажи
 * выводится строкой «Итого» под колонкой итогов строк, а не отдельным полем под таблицей.
 * Новая продажа сразу показывает пустую строку товара.
 */
const goodsOptions: TablePartOptions = {
    columnWidths: { code: 110, postedIn1C: 130, cost: 120, discount: 110, total: 120 },
    columnShares: { name: 1, comment: 1.6 },
    columnOrder: ['name', 'code', 'postedIn1C', 'cost', 'discount', 'total', 'comment'],
    columnInputs: { postedIn1C: PostedIn1CSwitch },
    addTitle: 'Товар',
    initialRow: true,
    totals: ['total'],
};

/** Отступы разделителя между частями продажи: поля над ним уже оставляют место снизу. */
const dividerStyle = { margin: '0 0 16px' };

/**
 * Кнопки новой продажи: только «Закрыть». Продажу проводит кнопка «Продать» под оплатами,
 * а запись без проведения новой продаже не нужна: продавец оформляет её у кассы целиком.
 * Сочетания клавиш записи и проведения продолжают работать.
 */
const newSaleButtons: RecordFormButtons = { actions: [], postAndClose: false };

/**
 * Размер кнопки «Продать». Это главное действие продавца у кассы, поэтому кнопка заметно крупнее
 * обычной крупной кнопки Ant Design и сразу находится взглядом под оплатой.
 */
const sellButtonStyle = { height: 64, paddingInline: 48, fontSize: 20 };

/** Строка товара на форме: до записи любая ячейка может быть пустой. */
interface GoodsLine {
    readonly name?: unknown;
    readonly cost?: unknown;
}

/** Строка оплаты на форме: до записи любая ячейка может быть пустой. */
interface PaymentLine {
    readonly method?: unknown;
    readonly amount?: unknown;
}

/**
 * Способ оплаты, на сумму которого при продаже оформляется рассрочка. Совпадает с `installmentMethod`
 * из `payments.ts`; константа оттуда не импортируется, потому что это серверный модуль.
 */
const installmentMethod = 'Рассрочка';

/** Оплата способом «Рассрочка» с суммой: на неё при продаже оформляется рассрочка. */
const isInstallment = (line: PaymentLine) => line.method === installmentMethod && typeof line.amount === 'number' && line.amount > 0;

/** Способ оплаты продажи из нескольких оплат разными способами. Совпадает с `complexPayment` продажи. */
const complexPayment = 'Сложная';

/** Строка оплаты, в которой что-то введено: способ, сумма или «Куда оплачено». */
const isFilledPayment = (line: Record<string, unknown>) => ['method', 'amount', 'receiver'].some((column) => (line[column] ?? null) !== null);

/**
 * Подготовка значений продажи перед записью. Сложная оплата, в которой заполнена одна строка,
 * становится простой оплатой способа этой строки: так продажа записывается так же, как если бы
 * продавец сразу выбрал простой способ, а пустые строки не мешают записи.
 */
function beforeSave(values: FormValues): FormValues | undefined {
    if (values['paymentMode'] !== complexPayment || !Array.isArray(values['payments'])) return undefined;
    const filled = (values['payments'] as ReadonlyArray<Record<string, unknown>>).filter(isFilledPayment);
    const [single] = filled;
    if (filled.length !== 1 || single === undefined || typeof single['method'] !== 'string') return undefined;
    return { ...values, paymentMode: single['method'], payments: [single] };
}

/** Поведение формы продажи: стандартное, с подготовкой оплаты перед записью. */
const saleFormOptions: RecordFormOptions = { beforeSave };

/** Товар введён, если у строки заполнены обязательные название и стоимость. */
const isEntered = (line: GoodsLine) => typeof line.name === 'string' && line.name.trim() !== '' && typeof line.cost === 'number';

/**
 * Форма продажи: шапка, товары и оплата в одном контейнере без заголовков групп.
 *
 * Поля шапки стоят в одну строку в fluid-компоновке: название поля в сегменте перед значением
 * экономит высоту шапки. Так же выведен способ оплаты. Сумма продажи и «Оплачено» отдельными
 * полями не выводятся: сумму показывает строка итогов товаров, а состояние оплаты выводит поле
 * «Способ оплаты» справа от своих кнопок.
 * Порядок частей и их состав берутся из групп описания формы, поэтому новое поле группы
 * появится на форме без правки раскладки.
 *
 * Элементы шапки выводятся отдельным блоком, и только у продажи с основанием: подстановка
 * открытой смены ничего не показывает, а её пустое место в раскладке раздвигало бы шапку.
 * Смонтированными они остаются всегда.
 *
 * Оплата появляется, когда введён хотя бы один товар с названием и стоимостью: платить до этого
 * не за что. Скрытый блок остаётся смонтированным, поэтому его элементы продолжают управлять
 * формой, а сумма простой оплаты следует за суммой продажи.
 *
 * Новая продажа выводит под оплатой крупную кнопку «Продать». Она выполняет стандартное
 * проведение: несохранённую продажу форма сначала записывает, а отказ политики показывает
 * так же, как при проведении кнопкой «Провести».
 *
 * Если часть оплаты внесена способом «Рассрочка», справа от оплат появляется блок рассрочки,
 * а на узком экране он переносится под оплаты. Кнопка становится «Продать + Рассрочка» и выполняет
 * действие продажи «Продать с рассрочкой»: оно в одной транзакции проводит продажу и оформляет
 * и проводит рассрочку по ней. Продажу форма перед действием записывает отдельным запросом,
 * поэтому при отказе действия она остаётся записанной, но не проведённой, и рассрочки нет.
 */
function SaleFormLayout({ state }: { readonly state: RecordFormState }) {
    const items = (title: string) => state.view.groups.find((group) => group.title === title)?.elements ?? [];
    const isElement = (item: string | FormElementReference): item is FormElementReference => typeof item !== 'string';
    const header = items('Продажа');
    const common = { record: state.record, disabled: !state.editable, traversal: state.traversal };
    const goods: unknown = Form.useWatch('goods', { form: state.form, preserve: true });
    const paymentShown = Array.isArray(goods) && goods.some((line: GoodsLine) => isEntered(line));
    const payments: unknown = Form.useWatch('payments', { form: state.form, preserve: true });
    const shift: unknown = Form.useWatch('shift', { form: state.form, preserve: true });
    const [terms, setTerms] = useState<SaleInstallmentTerms>(emptyInstallmentTerms);
    // Ошибки блока рассрочки показываются после первой попытки продать, а не сразу при его появлении.
    const [termsChecked, setTermsChecked] = useState(false);
    const isNew = state.record === null;
    const sell = isNew ? state.postAction : undefined;
    const sellWithInstallment = state.view.actions.find((action) => action.name === 'sellWithInstallment');
    // Без права на действие продажа с рассрочкой проводится как обычная, а рассрочку оформляют потом на форме продажи.
    const withInstallment = isNew && sellWithInstallment !== undefined && Array.isArray(payments) && payments.some((line: PaymentLine) => isInstallment(line));
    const problems = withInstallment && termsChecked ? installmentTermsProblems(terms) : [];
    const runSell = () => {
        if (withInstallment) {
            setTermsChecked(true);
            if (installmentTermsProblems(terms).length > 0) return Promise.resolve();
            return state.run(sellWithInstallment, (saved) => ({ sale: saved['guid'], ...terms }));
        }
        return sell === undefined ? Promise.resolve() : state.run(sell);
    };
    return (
        <RecordFormPage state={state} {...(state.record === null ? { buttons: newSaleButtons } : {})}>
            <Card size="small">
                <FieldGroup elements={recordFormElements(state, header.filter((item) => !isElement(item)))} layout="fluid" {...common} />
                <div hidden={(state.record?.['basis'] ?? null) === null}>
                    <FieldGroup elements={recordFormElements(state, header.filter(isElement))} />
                </div>
                <Divider style={dividerStyle} />
                <FieldGroup elements={recordFormElements(state, items('Товары').filter((item) => item !== 'amount'))} tablePartOptions={{ goods: goodsOptions }} {...common} />
                <div hidden={!paymentShown}>
                    <Divider style={dividerStyle} />
                    {/* Оплаты не шире своего содержимого, поэтому блок рассрочки стоит сразу за ними,
                        а не у края формы. На узком экране он переносится под оплаты. */}
                    <Flex wrap gap="large" align="flex-start">
                        <div style={{ flex: '0 1 960px', minWidth: 0 }}>
                            <FieldGroup elements={recordFormElements(state, items('Оплата').filter((item) => item !== 'paid'))} layout="fluid" fullWidth={['paymentMode']} {...common} />
                        </div>
                        {withInstallment && (
                            <div style={{ flex: '1 1 320px', maxWidth: 480 }}>
                                <SaleInstallmentBlock terms={terms} onChange={setTerms} shift={typeof shift === 'string' ? shift : null} disabled={state.running !== null} problems={problems} />
                            </div>
                        )}
                    </Flex>
                    {sell !== undefined && (
                        <Button
                            type="primary"
                            size="large"
                            icon={<Icons.sell />}
                            style={sellButtonStyle}
                            loading={state.running !== null && (state.running === sell.name || state.running === sellWithInstallment?.name)}
                            disabled={state.running !== null}
                            // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
                            onClick={() => runSell().catch(() => undefined)}
                        >
                            {withInstallment ? 'Продать + Рассрочка' : 'Продать'}
                        </Button>
                    )}
                </div>
            </Card>
        </RecordFormPage>
    );
}

/** Форма существующей продажи. Поведение формы стандартное, меняется только раскладка. */
export function SaleRecordForm(properties: RecordFormProperties) {
    return <SaleFormLayout state={useRecordForm(properties, saleFormOptions)} />;
}

/** Форма новой продажи с той же раскладкой. */
export function SaleNewForm(properties: NewFormProperties) {
    return <SaleFormLayout state={useRecordForm(properties, saleFormOptions)} />;
}
