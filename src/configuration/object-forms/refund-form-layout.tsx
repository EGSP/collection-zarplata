import { Button, Card } from 'antd';
import { RefundSaleGoods } from './refund-sale-goods';
import { FieldGroup, Icons, recordFormElements, RecordFormPage, Stack, useRecordForm, type NewFormProperties, type RecordFormButtons, type RecordFormOptions, type RecordFormProperties, type RecordFormState, type TablePartOptions } from '../../web/sdk';

/**
 * Новый возврат записывается и проводится одним запросом: если проведение отклонено, например по
 * пределу возврата, возврат не создаётся и остаётся на форме, а не появляется в списке черновиком.
 */
const refundFormOptions: RecordFormOptions = { atomicPosting: true };

/** Новый возврат: стандартные действия не выводятся, их заменяет кнопка «Оформить возврат». */
const refundButtons: RecordFormButtons = { actions: [], postAndClose: false };

/** Размер главной кнопки: как у кнопки «Отвесить» на форме отвеса. */
const mainButtonStyle = { height: 64, paddingInline: 48, fontSize: 20 };

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
 */
const goodsOptions: TablePartOptions = {
    fixedRows: true,
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
                            <Button
                                type="primary"
                                size="large"
                                icon={<Icons.refund />}
                                style={mainButtonStyle}
                                loading={state.running === post.name}
                                disabled={state.running !== null}
                                // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
                                onClick={() => state.run(post).catch(() => undefined)}
                            >
                                Оформить возврат
                            </Button>
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
