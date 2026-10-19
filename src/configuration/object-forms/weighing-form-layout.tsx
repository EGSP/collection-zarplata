import { Button, Card, Divider, Flex, Modal, Table } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Objects } from '../objects.generated';
import { FieldGroup, Icons, recordFormElements, RecordFormPage, useObjectView, useOpenRecord, useRecordForm, useWindowScope, type FormElementReference, type NewFormProperties, type RecordFormButtons, type RecordFormProperties, type RecordFormState, type TablePartOptions } from '../../web/sdk';

/**
 * Состояния строки отвеса. Совпадают со значениями в описании отвеса: форма не импортирует их
 * из файла объекта, иначе в клиент попал бы серверный код.
 */
const held = 'В отвесе';
const hung = 'Вывешено';

/**
 * Вид таблицы товаров нового отвеса. Стоимость, скидка, итог и «Проведено в 1С» не выводятся: отвес
 * только откладывает товар, а эти сведения заполняются в продаже из отвеса. Стоимость в части
 * обязательна, поэтому новая строка получает нулевую; продажа из отвеса переносит её, и продавец
 * вводит стоимость уже в продаже.
 *
 * Код стоит перед названием, как в продаже. Код и состояние короткие, поэтому их колонки узкие.
 * Остаток ширины делят название, продажа
 * и комментарий; комментарий стоит последним, как в продаже. Кнопка добавления подписана
 * «Отвес»: вместе со значком «+» она читается как «+ Отвес».
 *
 * Состояние и продажа только для чтения на обеих формах отвеса. Их проставляют действия:
 * продажа из отвеса отмечает строки проданными и ссылается на себя, кнопка «Вывесить» переводит
 * строки в «Вывешено». Новая строка получает состояние «В отвесе» начальным значением.
 */
const newGoodsOptions: TablePartOptions = {
    columnWidths: { code: 110, size: 100, state: 140 },
    columnShares: { name: 1, sale: 1, comment: 1.6 },
    columnOrder: ['code', 'name', 'size', 'state', 'sale', 'comment'],
    hiddenColumns: ['postedIn1C', 'cost', 'discount', 'total'],
    readOnlyColumns: ['state', 'sale'],
    newRow: () => ({ cost: 0 }),
    addTitle: 'Отвес',
    initialRow: true,
};

/**
 * Вид таблицы товаров записанного отвеса. Состав строк не меняется: строки не добавляются
 * и не удаляются. Состояние и продажа только для чтения, как и у нового отвеса.
 */
const savedGoodsOptions: TablePartOptions = {
    ...newGoodsOptions,
    initialRow: false,
    fixedRows: true,
};

/**
 * Кнопки вверху формы: только «Закрыть». Отвес оформляют кнопки под товарами: «Отвесить» у нового
 * отвеса, «Продать» и «Вывесить» у записанного. Сочетания клавиш записи и проведения работают.
 */
const weighingButtons: RecordFormButtons = { actions: [], postAndClose: false };

/** Размер главных кнопок под товарами: как у кнопки «Продать» на форме продажи. */
const mainButtonStyle = { height: 64, paddingInline: 48, fontSize: 20 };

/** Отступы разделителя между частями формы: поля над ним уже оставляют место снизу. */
const dividerStyle = { margin: '0 0 16px' };

/** Строка записанного отвеса, как её отдаёт сервер. */
interface WeighingLine {
    readonly name: string;
    readonly code: string | null;
    readonly size: string | null;
    readonly comment: string | null;
    readonly cost: number;
    readonly discount: number | null;
    readonly state: string;
}

/** Товар в отвесе и его номер среди строк отвеса. */
interface HeldLine extends WeighingLine {
    readonly lineNumber: number;
}

/** Свойства окна выбора товаров в отвесе. */
interface HeldLinesDialogProperties {
    readonly open: boolean;
    readonly title: string;
    /** Подпись кнопки подтверждения выбора. */
    readonly confirm: string;
    readonly lines: ReadonlyArray<HeldLine>;
    readonly loading?: boolean;
    readonly onConfirm: (lineNumbers: ReadonlyArray<number>) => void;
    readonly onCancel: () => void;
    /** Вызывается, когда окно закрылось полностью, после анимации закрытия. */
    readonly onClosed?: () => void;
}

/**
 * Окно выбора товаров в отвесе: общее для продажи и вывешивания. Выбор сбрасывается при каждом
 * открытии, чтобы прежний выбор не применился к другому действию. После служебных колонок
 * выбора и номера строки реквизиты товара начинаются с кода и названия.
 */
function HeldLinesDialog({ open, title, confirm, lines, loading = false, onConfirm, onCancel, onClosed }: HeldLinesDialogProperties) {
    const [selected, setSelected] = useState<ReadonlyArray<number>>([]);
    useEffect(() => {
        if (open) setSelected([]);
    }, [open]);
    return (
        <Modal
            open={open}
            width={900}
            title={title}
            okText={confirm}
            cancelText="Отмена"
            okButtonProps={{ disabled: selected.length === 0 }}
            confirmLoading={loading}
            onOk={() => onConfirm(selected)}
            onCancel={onCancel}
            {...(onClosed === undefined ? {} : { afterClose: onClosed })}
        >
            <Table<HeldLine>
                size="small"
                pagination={false}
                rowKey="lineNumber"
                dataSource={[...lines]}
                rowSelection={{ selectedRowKeys: [...selected], onChange: (keys) => setSelected(keys.map(Number)) }}
                columns={[
                    { key: 'lineNumber', dataIndex: 'lineNumber', title: '№', width: 48 },
                    { key: 'code', dataIndex: 'code', title: 'Код', width: 110 },
                    { key: 'name', dataIndex: 'name', title: 'Название' },
                    { key: 'comment', dataIndex: 'comment', title: 'Комментарий' },
                ]}
                locale={{ emptyText: 'Товаров в отвесе нет' }}
            />
        </Modal>
    );
}

/**
 * Кнопки записанного отвеса: «Продать» и «Вывесить». Обе открывают окно выбора из товаров
 * «В отвесе»; строки берутся из записанного отвеса, потому что их номера должны совпадать
 * с записью, которую проверяет сервер.
 *
 * «Продать» открывает новой вкладкой продажу с отвесом в основании, сменой отвеса и выбранными
 * товарами с номерами их строк. Продавец заполняет стоимость и оплату и проводит продажу, а её
 * проведение само отмечает строки отвеса проданными. Продажа относится к смене отвеса: результат
 * засчитывается тем, кто отвесил.
 *
 * «Вывесить» переводит выбранные строки в «Вывешено» и сразу записывает отвес: проведённый
 * отвес проводится заново, чтобы записанное состояние не расходилось с проведённым.
 */
function SavedWeighingActions({ state }: { readonly state: RecordFormState }) {
    const openRecord = useOpenRecord();
    const [choosing, setChoosing] = useState<'sell' | 'hang' | null>(null);
    // Строки продажи ждут закрытия окна: вкладка продажи открывается после него. Иначе вкладка
    // отвеса скрылась бы посреди анимации закрытия, и окно осталось бы поверх вкладки продажи.
    const pendingSale = useRef<ReadonlyArray<number> | null>(null);
    // Кнопки «Продать» нет у пользователя без права провести продажу: оформить её он всё равно не сможет.
    const sellable = useObjectView(Objects.document.sale)?.form?.actions.some((action) => action.name === 'post') === true;
    const record = state.record;
    if (record === null) return null;
    const goods = (record['goods'] ?? []) as ReadonlyArray<WeighingLine>;
    const lines: ReadonlyArray<HeldLine> = goods.flatMap((line, index) => (line.state === held ? [{ ...line, lineNumber: index + 1 }] : []));
    const writeAction = state.view.actions.find((action) => action.standard && action.name === (record['posted'] === true ? 'post' : 'save'));

    const sell = (numbers: ReadonlyArray<number>) => {
        const goodsOfSale = lines
            .filter((line) => numbers.includes(line.lineNumber))
            // Новый документ ещё не внесён в 1С, поэтому отметка «Проведено в 1С» не переносится.
            .map((line) => ({ name: line.name, code: line.code, size: line.size, comment: line.comment, postedIn1C: false, cost: line.cost, discount: line.discount, weighingLine: line.lineNumber }));
        // Об ошибке открытия вкладки сообщать нечего: переход по адресу не завершается отказом сервера.
        openRecord(Objects.document.sale, null, 'tab', { initial: { basis: record['guid'], shift: record['shift'], goods: goodsOfSale } }).catch(() => undefined);
    };
    const hang = (numbers: ReadonlyArray<number>) => {
        if (writeAction === undefined) return;
        const entered = (state.form.getFieldValue('goods') ?? []) as ReadonlyArray<Record<string, unknown>>;
        state.form.setFieldValue('goods', entered.map((line, index) => (numbers.includes(index + 1) ? { ...line, state: hung } : line)));
        state.markChanged();
        // Окно закрывается после записи; при отказе сервера оно остаётся открытым, а уведомление уже показано.
        state.run(writeAction).then(() => setChoosing(null), () => undefined);
    };

    return (
        <>
            <Flex gap="middle" wrap>
                {sellable && (
                    <Button type="primary" size="large" icon={<Icons.sell />} style={mainButtonStyle} disabled={lines.length === 0 || state.running !== null} onClick={() => setChoosing('sell')}>
                        Продать
                    </Button>
                )}
                {state.editable && writeAction !== undefined && (
                    <Button size="large" icon={<Icons.hang />} style={mainButtonStyle} disabled={lines.length === 0 || state.running !== null} onClick={() => setChoosing('hang')}>
                        Вывесить
                    </Button>
                )}
            </Flex>
            <HeldLinesDialog
                open={choosing === 'sell'}
                title="Продажа товаров из отвеса"
                confirm="Оформить продажу"
                lines={lines}
                onConfirm={(numbers) => {
                    pendingSale.current = numbers;
                    setChoosing(null);
                }}
                onCancel={() => setChoosing(null)}
                onClosed={() => {
                    const numbers = pendingSale.current;
                    pendingSale.current = null;
                    if (numbers !== null) sell(numbers);
                }}
            />
            <HeldLinesDialog
                open={choosing === 'hang'}
                title="Вывешивание товаров из отвеса"
                confirm="Вывесить"
                lines={lines}
                loading={state.running !== null}
                onConfirm={hang}
                onCancel={() => setChoosing(null)}
            />
        </>
    );
}

/**
 * Перечитывает записанный отвес, когда его вкладка снова становится активной. Продажа из отвеса
 * открывается отдельной вкладкой и при проведении меняет отвес на сервере, а форма отвеса
 * об этом не знает. Форму с несохранёнными изменениями хук не трогает: перечитывание стёрло бы ввод.
 */
function useReloadOnActivation(state: RecordFormState) {
    const { active } = useWindowScope();
    const wasActive = useRef(active);
    useEffect(() => {
        const activated = active && !wasActive.current;
        wasActive.current = active;
        if (!activated || state.record === null || state.hasChanges() || state.running !== null) return;
        // Об ошибке чтения сообщило уведомление; форма остаётся с прежней записью.
        state.reloadRecord().catch(() => undefined);
    }, [active]);
}

/**
 * Форма отвеса: шапка и товары в одном контейнере без заголовков групп, кнопки действий
 * под товарами. Стандартные кнопки вверху скрыты, остаётся только «Закрыть».
 *
 * Поля шапки стоят в fluid-компоновке, как у продажи: название поля в сегменте перед значением
 * экономит высоту. Элементы группы шапки ничего не выводят (подстановка открытой смены),
 * поэтому стоят в скрытом блоке: смонтированными они продолжают работать. Состав частей
 * берётся из групп описания формы, поэтому новое поле группы появится на форме без правки раскладки.
 *
 * Новый отвес оформляет кнопка «Отвесить»: стандартное проведение, перед которым форма записывает
 * отвес. После проведения вкладка переходит на записанный отвес.
 */
function WeighingFormLayout({ state }: { readonly state: RecordFormState }) {
    const items = (title: string) => state.view.groups.find((group) => group.title === title)?.elements ?? [];
    const isElement = (item: string | FormElementReference): item is FormElementReference => typeof item !== 'string';
    const header = items('Отвес');
    const common = { record: state.record, disabled: !state.editable, traversal: state.traversal };
    const isNew = state.record === null;
    const weigh = isNew ? state.postAction : undefined;
    useReloadOnActivation(state);
    return (
        <RecordFormPage state={state} buttons={weighingButtons}>
            <Card size="small">
                {/* Поле покупателя стоит отдельной строкой под разделителем: оно длинное и с остальной шапкой в строку не помещается. */}
                <FieldGroup elements={recordFormElements(state, header.filter((item) => !isElement(item) && item !== 'person'))} layout="fluid" {...common} />
                <Divider style={dividerStyle} />
                <FieldGroup elements={recordFormElements(state, header.filter((item) => !isElement(item) && item === 'person'))} layout="fluid" {...common} />
                <div hidden>
                    <FieldGroup elements={recordFormElements(state, header.filter(isElement))} />
                </div>
                <Divider style={dividerStyle} />
                <FieldGroup elements={recordFormElements(state, items('Товары'))} tablePartOptions={{ goods: isNew ? newGoodsOptions : savedGoodsOptions }} {...common} />
                <Divider style={dividerStyle} />
                {weigh !== undefined && (
                    <Button
                        type="primary"
                        size="large"
                        icon={<Icons.weigh />}
                        style={mainButtonStyle}
                        loading={state.running === weigh.name}
                        disabled={state.running !== null}
                        // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
                        onClick={() => state.run(weigh).catch(() => undefined)}
                    >
                        Отвесить
                    </Button>
                )}
                {!isNew && <SavedWeighingActions state={state} />}
            </Card>
        </RecordFormPage>
    );
}

/** Форма существующего отвеса. Поведение формы стандартное, меняется раскладка и кнопки. */
export function WeighingRecordForm(properties: RecordFormProperties) {
    return <WeighingFormLayout state={useRecordForm(properties)} />;
}

/** Форма нового отвеса с той же раскладкой. */
export function WeighingNewForm(properties: NewFormProperties) {
    return <WeighingFormLayout state={useRecordForm(properties)} />;
}
