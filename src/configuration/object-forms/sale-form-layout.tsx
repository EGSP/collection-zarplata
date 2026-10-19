import { Button, Card, Divider, Form } from 'antd';
import { useEffect, useState } from 'react';
import { PostedIn1CSwitch } from './posted-in-1c-switch';
import { SaleChanges } from './sale-changes';
import { LinkedSaleInstallments } from './linked-sale-installments';
import { emptyInstallmentTerms, installmentTermsInput, installmentTermsProblems, SaleInstallmentBlock, type SaleInstallmentTerms } from './sale-installment-block';
import { Objects } from '../objects.generated';
import { Column, FieldGroup, Grid, Icons, recordFormElements, RecordFormPage, useFormRestrictions, useRecord, useRecordForm, spacing, Stack, type ColumnCount, type FormElementReference, type FormPresentation, type NewFormProperties, type FormValues, type RecordFormButtons, type RecordFormOptions, type RecordFormProperties, type RecordFormState, type TablePartOptions } from '../../web/sdk';

/**
 * Вид таблицы товаров. Код и стоимость короткие, поэтому их колонки вдвое уже, чем досталось бы
 * им в общей раскладке. Остаток ширины делят название и комментарий: названию треть, комментарию
 * две трети, потому что название товара короче комментария к нему. Комментарий стоит последним:
 * его заполняют реже остальных колонок, и при вводе строки он не прерывает путь от названия
 * к стоимости. «Проведено в 1С» выбирается переключателем «Да» / «Нет». Сумма продажи
 * выводится строкой «Итого» под колонкой итогов строк, а не отдельным полем под таблицей.
 * Новая продажа сразу показывает пустую строку товара. Номер строки отвеса не выводится: его
 * заполняет форма отвеса, когда открывает продажу из него, а продавцу он не нужен.
 */
const goodsOptions: TablePartOptions = {
    columnWidths: { code: 110, size: 100, postedIn1C: 130, cost: 120, discount: 110, total: 120 },
    columnShares: { name: 1, comment: 1.6 },
    columnOrder: ['name', 'code', 'size', 'postedIn1C', 'cost', 'discount', 'total', 'comment'],
    columnInputs: { postedIn1C: PostedIn1CSwitch },
    addTitle: 'Товар',
    initialRow: true,
    totals: ['total'],
    hiddenColumns: ['weighingLine'],
};

/** Отступы разделителя между частями продажи: поля над ним уже оставляют место снизу. */
const dividerStyle = { marginBlock: spacing[6] };

/**
 * Панель любой продажи: только «Закрыть» и меню «Ещё» с собственными действиями и журналом.
 * Новую продажу и черновик оформляет «Продать», проведённую меняют через «Внести изменения»
 * и отменяют через «Отмена продажи». Стандартные команды не предлагают отдельную запись продажи.
 * Сочетания клавиш записи и проведения продолжают работать.
 */
const saleButtons: RecordFormButtons = { actions: [], postAndClose: false };

/**
 * Размер кнопки «Продать». Это главное действие продавца у кассы, поэтому кнопка заметно крупнее
 * обычной крупной кнопки Ant Design и сразу находится взглядом под оплатой.
 */
const sellButtonStyle = { height: 64, paddingInline: 48, fontSize: 20 };

/** Ширины оплат и блока рассрочки в колонках сетки: вместе они занимают строку начиная с `lg`. */
const paymentSpan: ColumnCount = { lg: 10 };
const installmentSpan: ColumnCount = { lg: 6 };

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

/**
 * Действия, которые форма не предлагает в режиме изменения: запись и проведение заменяет
 * «Сохранить изменения», отмену продажи экран предлагает сам, без записи введённых изменений,
 * а «Продать с рассрочкой» нужна только новой продаже.
 */
const actionsHiddenWhileEditing = ['save', 'post', 'unpost', 'markDeleted', 'unmarkDeleted', 'cancel', 'sellWithInstallment'] as const;

/**
 * Ограничения формы проведённой и отменённой продажи. Вне режима изменения она только для просмотра:
 * изменения продажи с рассрочками должны записываться вместе с ними, а стандартная запись
 * изменила бы одну продажу. Отменённая продажа помечена на удаление и тоже только для просмотра.
 * В режиме изменения недоступны номер, дата и смена: они определяют место продажи в учёте смен
 * и закрытых периодов.
 */
function SaleEditingRestrictions({ editing, cancelled }: { readonly editing: boolean; readonly cancelled: boolean }) {
    useFormRestrictions(Objects.document.sale, editing
        ? { readOnlyFields: ['number', 'date', 'shift'], hiddenActions: [...actionsHiddenWhileEditing] }
        // «Продать с рассрочкой» нужна только новой продаже. Отменённая продажа остаётся
        // только для просмотра: вместо её восстановления оформляют новую.
        : { readOnly: true, hiddenActions: cancelled ? ['sellWithInstallment', 'post'] : ['sellWithInstallment'] });
    return null;
}

/**
 * Черновик продажи продают кнопкой «Продать» под оплатой, как новую продажу. Стандартная кнопка
 * «Продать с рассрочкой» скрыта: её окно потребовало бы заново выбрать продажу и условия.
 */
function DraftRestrictions() {
    useFormRestrictions(Objects.document.sale, { hiddenActions: ['sellWithInstallment'] });
    return null;
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
 * Элементы шапки выводятся отдельным блоком, и только у продажи с основанием, в том числе у новой
 * продажи, которую открыл отвес: подстановка
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
 *
 * Проведённая продажа открывается только для просмотра, а под оплатой стоит крупная кнопка
 * «Внести изменения». Она переводит форму в режим изменения: товары и оплаты становятся
 * доступны, а под продажей через штриховые разделители выводятся её рассрочки (`SaleChanges`).
 * Продажу и рассрочки записывает одним запросом действие `saveChanges`. Кнопки нет без права
 * на действие и у продажи, помеченной на удаление.
 */
function SaleFormLayout({ state, presentation }: { readonly state: RecordFormState; readonly presentation: FormPresentation }) {
    const items = (title: string) => state.view.groups.find((group) => group.title === title)?.elements ?? [];
    const isElement = (item: string | FormElementReference): item is FormElementReference => typeof item !== 'string';
    const header = items('Продажа');
    const common = { record: state.record, disabled: !state.editable, traversal: state.traversal };
    const goods: unknown = Form.useWatch('goods', { form: state.form, preserve: true });
    const paymentShown = Array.isArray(goods) && goods.some((line: GoodsLine) => isEntered(line));
    const payments: unknown = Form.useWatch('payments', { form: state.form, preserve: true });
    const shift: unknown = Form.useWatch('shift', { form: state.form, preserve: true });
    const basis: unknown = Form.useWatch('basis', { form: state.form, preserve: true });
    const [terms, setTerms] = useState<SaleInstallmentTerms>(emptyInstallmentTerms);
    // Покупатель рассрочки по умолчанию — покупатель отвеса-основания: продавец уже ввёл его в отвесе.
    // Подставляется, только пока покупатель не выбран, поэтому выбор продавца не перезаписывается.
    const weighingPerson = useRecord(Objects.document.weighing, typeof basis === 'string' ? basis : null).record?.person ?? null;
    useEffect(() => {
        if (weighingPerson !== null) setTerms((previous) => previous.person === null ? { ...previous, person: weighingPerson } : previous);
    }, [weighingPerson]);
    // Ошибки блока рассрочки показываются после первой попытки продать, а не сразу при его появлении.
    const [termsChecked, setTermsChecked] = useState(false);
    const isNew = state.record === null;
    const [editing, setEditing] = useState(false);
    // Режим изменения есть только у проведённой продажи без пометки удаления: черновик меняется на форме как обычно.
    const posted = state.record !== null && state.record['posted'] === true && (state.record['deletedAt'] ?? null) === null;
    // Отменённая продажа помечена на удаление и тоже только для просмотра: её не меняют, а оформляют новую.
    const locked = posted || (state.record !== null && (state.record['deletedAt'] ?? null) !== null);
    // Совместная форма с рассрочками предназначена для вкладки; модальная карточка показывает продажу.
    const changesAvailable = presentation === 'page' && posted && ['saveChanges', 'changesState'].every((name) => state.view.actions.some((action) => action.name === name));
    // Продать можно новую продажу и записанный черновик: черновик остаётся, например, когда сервер
    // отклонил продажу с рассрочкой, и продавец допродаёт его той же кнопкой с условиями рассрочки.
    const sellable = isNew || !locked;
    const sell = sellable ? state.postAction : undefined;
    const sellWithInstallment = state.view.actions.find((action) => action.name === 'sellWithInstallment');
    // Без права на действие продать с оплатой «Рассрочка» нельзя: обычное проведение такую продажу отклонит.
    const withInstallment = sellable && sellWithInstallment !== undefined && Array.isArray(payments) && payments.some((line: PaymentLine) => isInstallment(line));
    // Сумма рассрочки — сумма оплаты способом «Рассрочка»: первоначальный взнос должен быть меньше неё.
    const installmentAmount = Array.isArray(payments) ? payments.filter((line: PaymentLine) => isInstallment(line)).reduce((total: number, line: PaymentLine) => total + (line.amount as number), 0) : 0;
    const problems = withInstallment && termsChecked ? installmentTermsProblems(terms, installmentAmount) : [];
    const runSell = () => {
        if (withInstallment) {
            setTermsChecked(true);
            if (installmentTermsProblems(terms, installmentAmount).length > 0) return Promise.resolve();
            return state.run(sellWithInstallment, (saved) => ({ sale: saved['guid'], ...installmentTermsInput(terms) }));
        }
        return sell === undefined ? Promise.resolve() : state.run(sell);
    };
    return (
        <RecordFormPage state={state} buttons={saleButtons}>
            {locked && <SaleEditingRestrictions editing={posted && editing} cancelled={!posted} />}
            {!isNew && !locked && <DraftRestrictions />}
            <Card size="small">
                <FieldGroup elements={recordFormElements(state, header.filter((item) => !isElement(item)))} layout="fluid" {...common} />
                <div hidden={(basis ?? state.record?.['basis'] ?? null) === null}>
                    <FieldGroup elements={recordFormElements(state, header.filter(isElement))} />
                </div>
                <Divider style={dividerStyle} />
                <FieldGroup elements={recordFormElements(state, items('Товары').filter((item) => item !== 'amount'))} tablePartOptions={{ goods: goodsOptions }} {...common} />
                <div hidden={!paymentShown}>
                    <Divider style={dividerStyle} />
                    {/* Расстояние между оплатами и кнопкой задаёт стек: группы полей своих внешних отступов не имеют. */}
                    <Stack gap={6}>
                        {/* Начиная с `lg` блок рассрочки стоит справа от оплат, на более узкой форме — под ними.
                            Оплаты не растягиваются на всю форму и без рассрочки: их ширина не зависит от выбора способа оплаты. */}
                        <Grid>
                            <Column span={paymentSpan}>
                                <FieldGroup elements={recordFormElements(state, items('Оплата').filter((item) => item !== 'paid'))} layout="fluid" fullWidth={['paymentMode']} {...common} />
                            </Column>
                            {withInstallment && (
                                <Column span={installmentSpan}>
                                    <SaleInstallmentBlock terms={terms} onChange={setTerms} shift={typeof shift === 'string' ? shift : null} disabled={state.running !== null} problems={problems} input={sellWithInstallment?.input ?? []} />
                                </Column>
                            )}
                        </Grid>
                        <div>
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
                            {changesAvailable && !editing && (
                                <Button type="primary" size="large" icon={<Icons.edit />} style={sellButtonStyle} disabled={state.running !== null} onClick={() => setEditing(true)}>
                                    Внести изменения
                                </Button>
                            )}
                        </div>
                    </Stack>
                </div>
                {changesAvailable && editing && <SaleChanges state={state} prepare={beforeSave} onClose={() => setEditing(false)} />}
                {presentation === 'page' && !editing && typeof state.record?.['guid'] === 'string' && <LinkedSaleInstallments sale={state.record['guid']} />}
            </Card>
        </RecordFormPage>
    );
}

/** Форма существующей продажи. Поведение формы стандартное, меняется только раскладка. */
export function SaleRecordForm(properties: RecordFormProperties) {
    return <SaleFormLayout state={useRecordForm(properties, saleFormOptions)} presentation={properties.presentation} />;
}

/** Форма новой продажи с той же раскладкой. */
export function SaleNewForm(properties: NewFormProperties) {
    return <SaleFormLayout state={useRecordForm(properties, saleFormOptions)} presentation={properties.presentation} />;
}
