import { Button, Card, Divider, Form } from 'antd';
import { PostedIn1CSwitch } from './posted-in-1c-switch';
import { FieldGroup, Icons, recordFormElements, RecordFormPage, useRecordForm, type FormElementReference, type NewFormProperties, type RecordFormButtons, type RecordFormProperties, type RecordFormState, type TablePartOptions } from '../../web/sdk';

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
    columnWidths: { code: 110, postedIn1C: 110, cost: 120, discount: 110, total: 120 },
    columnShares: { name: 1, comment: 2 },
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
 */
function SaleFormLayout({ state }: { readonly state: RecordFormState }) {
    const items = (title: string) => state.view.groups.find((group) => group.title === title)?.elements ?? [];
    const isElement = (item: string | FormElementReference): item is FormElementReference => typeof item !== 'string';
    const header = items('Продажа');
    const common = { record: state.record, disabled: !state.editable, traversal: state.traversal };
    const goods: unknown = Form.useWatch('goods', { form: state.form, preserve: true });
    const paymentShown = Array.isArray(goods) && goods.some((line: GoodsLine) => isEntered(line));
    const { postAction } = state;
    const sell = state.record === null ? postAction : undefined;
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
                    <FieldGroup elements={recordFormElements(state, items('Оплата').filter((item) => item !== 'paid'))} layout="fluid" fullWidth={['paymentMode']} {...common} />
                    {sell !== undefined && (
                        <Button
                            type="primary"
                            size="large"
                            icon={<Icons.sell />}
                            style={sellButtonStyle}
                            loading={state.running === sell.name}
                            disabled={state.running !== null}
                            // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
                            onClick={() => state.run(sell).catch(() => undefined)}
                        >
                            Продать
                        </Button>
                    )}
                </div>
            </Card>
        </RecordFormPage>
    );
}

/** Форма существующей продажи. Поведение формы стандартное, меняется только раскладка. */
export function SaleRecordForm(properties: RecordFormProperties) {
    return <SaleFormLayout state={useRecordForm(properties)} />;
}

/** Форма новой продажи с той же раскладкой. */
export function SaleNewForm(properties: NewFormProperties) {
    return <SaleFormLayout state={useRecordForm(properties)} />;
}
