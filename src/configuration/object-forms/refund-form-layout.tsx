import { Card } from 'antd';
import { goodsColumnSizes } from './goods-columns';
import { RefundSaleGoods } from './refund-sale-goods';
import { FieldGroup, Icons, MainActionButton, recordFormElements, RecordFormPage, Stack, useRecordForm, type NewFormProperties, type RecordFormButtons, type RecordFormOptions, type RecordFormProperties, type RecordFormState, type TablePartOptions } from '../../web/sdk';

/**
 * Новый возврат записывается и проводится одним запросом: если проведение отклонено, например по
 * пределу возврата, возврат не создаётся и остаётся на форме, а не появляется в списке черновиком.
 */
const refundFormOptions: RecordFormOptions = { atomicPosting: true };

/** Новый возврат: стандартные действия не выводятся, их заменяет кнопка «Оформить возврат». */
const refundButtons: RecordFormButtons = { actions: [], postAndClose: false };


/**
 * Основания возврата. Строку добавляет связь с продажей, а не пустая строка: значок цепи показывает,
 * что строка ссылается на продажу, из которой возвращают товары. Под строкой, изначально раскрытой,
 * стоят товары этой продажи с флажками: отмеченные попадают в «Товары на возврат».
 */
const basesOptions: TablePartOptions = {
    addTitle: 'Связать с продажей',
    addIcon: <Icons.link />,
    expandedRow: (row) => typeof row.sale === 'string' ? <RefundSaleGoods sale={row.sale} /> : null,
};

/**
 * «Товары на возврат» заполняют флажки у товаров под строками оснований: строки копируются из продаж, а не
 * вводятся вручную. Поэтому строки фиксированы, а все колонки только для чтения.
 *
 * Колонки стоят в порядке продажи и с её размерами. Уже `xlg` код стоит над названием, а уже `lg`
 * объединены ещё размер и «Проведено в 1С», стоимость и скидка, комментарий и продажа.
 */
const goodsOptions: TablePartOptions = {
    fixedRows: true,
    columnSizes: goodsColumnSizes,
    columnOrder: ['code', 'name', 'size', 'postedIn1C', 'cost', 'discount', 'total', 'comment', 'sale'],
    layouts: {
        sm: [['code', 'name'], ['size', 'postedIn1C'], ['cost', 'discount'], 'total', ['comment', 'sale']],
        lg: [['code', 'name'], 'size', 'postedIn1C', 'cost', 'discount', 'total', 'comment', 'sale'],
        xlg: ['code', 'name', 'size', 'postedIn1C', 'cost', 'discount', 'total', 'comment', 'sale'],
    },
    readOnlyColumns: ['name', 'code', 'size', 'comment', 'postedIn1C', 'cost', 'discount', 'total', 'sale'],
};

/**
 * Форма возврата: шапка, основания и товары в одной группе без заголовка. Шапка в fluid-компоновке,
 * как у отвеса и продажи. Элементы конфигурации берутся из описания групп формы,
 * поэтому новый элемент появится на форме без правки раскладки.
 *
 * Новый возврат оформляет кнопка «Оформить возврат»: стандартное проведение, которое записывает
 * возврат и проводит его. Существующий возврат показывает стандартные кнопки действий.
 */
function RefundFormLayout({ state }: { readonly state: RecordFormState }) {
    const elements = state.view.groups.flatMap((group) => group.elements);
    const isNew = state.record === null;
    const post = isNew ? state.postAction : undefined;
    return (
        <RecordFormPage state={state} {...(isNew ? { buttons: refundButtons } : {})}>
            <Card size="small">
                {/* Расстояние между полями и кнопкой задаёт стек: группа полей своих внешних отступов не имеет. */}
                <Stack gap={6}>
                    <FieldGroup
                        elements={recordFormElements(state, elements)}
                        layout="fluid"
                        record={state.record}
                        disabled={!state.editable}
                        traversal={state.traversal}
                        tablePartOptions={{ bases: basesOptions, goods: goodsOptions }}
                    />
                    {/* Обёртка не даёт стеку растянуть кнопку на всю ширину. */}
                    <div>
                        {post !== undefined && (
                            <MainActionButton
                                type="primary"
                                icon={<Icons.refund />}
                                loading={state.running === post.name}
                                disabled={state.running !== null}
                                // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
                                onClick={() => state.run(post).catch(() => undefined)}
                            >
                                Оформить возврат
                            </MainActionButton>
                        )}
                    </div>
                </Stack>
            </Card>
        </RecordFormPage>
    );
}

/** Форма существующего возврата. Поведение формы стандартное, меняется раскладка. */
export function RefundRecordForm(properties: RecordFormProperties) {
    return <RefundFormLayout state={useRecordForm(properties, refundFormOptions)} />;
}

/** Форма нового возврата с той же раскладкой и кнопкой оформления. */
export function RefundNewForm(properties: NewFormProperties) {
    return <RefundFormLayout state={useRecordForm(properties, refundFormOptions)} />;
}
