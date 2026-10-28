import { Card, Divider, Flex, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { goodsColumnSizes } from './goods-columns';
import { Objects } from '../objects.generated';
import { BreakpointContainer, DataTable, FieldGroup, Icons, MainActionButton, recordFormElements, RecordFormPage, useObjectView, useOpenRecord, useRecordForm, spacing, useWindowScope, type FormElementReference, type NewFormProperties, type RecordFormButtons, type RecordFormProperties, type RecordFormState, type TablePartOptions } from '../../web/sdk';

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
 * Код стоит перед названием, а комментарий последним, как в продаже; размеры колонок общие с ней.
 * Уже точки `lg`, например в модальном окне, код стоит над названием, а состояние под размером. Кнопка добавления подписана
 * «Отвес»: вместе со значком «+» она читается как «+ Отвес».
 *
 * Состояние и продажа только для чтения на обеих формах отвеса. Их проставляют действия:
 * продажа из отвеса отмечает строки проданными и ссылается на себя, кнопка «Вывесить» переводит
 * строки в «Вывешено». Новая строка получает состояние «В отвесе» начальным значением.
 */
const newGoodsOptions: TablePartOptions = {
    columnSizes: goodsColumnSizes,
    layouts: {
        sm: [['code', 'name'], ['size', 'state'], 'sale', 'comment'],
        lg: ['code', 'name', 'size', 'state', 'sale', 'comment'],
    },
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


/** Отступы разделителя между частями формы: поля над ним уже оставляют место снизу. */
const dividerStyle = { marginBlock: spacing[6] };

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
            <BreakpointContainer of="fixed" point="sm">
                <DataTable<HeldLine>
                    rows={lines}
                    rowKey={(line) => line.lineNumber}
                    selection={{
                        mode: 'multiple',
                        isSelected: (line) => selected.includes(line.lineNumber),
                        onChange: (line, _index, checked) => setSelected((current) => checked ? [...current, line.lineNumber] : current.filter((number) => number !== line.lineNumber)),
                        onChangeAll: (checked) => setSelected(checked ? lines.map((line) => line.lineNumber) : []),
                    }}
                    columns={[
                        { key: 'lineNumber', title: '№', size: { minimum: 3 }, align: 'end', render: (line) => line.lineNumber },
                        { key: 'code', title: 'Код', size: { minimum: 8 }, render: (line) => line.code },
                        { key: 'name', title: 'Название', size: { minimum: 16, weight: 2 }, render: (line) => line.name },
                        { key: 'comment', title: 'Комментарий', size: { minimum: 14, weight: 3 }, render: (line) => line.comment },
                    ]}
                    // В окне код стоит над названием, как в таблице товаров отвеса на узком месте.
                    layouts={{ sm: ['lineNumber', ['code', 'name'], 'comment'] }}
                    emptyText="Товаров в отвесе нет"
                />
            </BreakpointContainer>
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
                    <MainActionButton type="primary" icon={<Icons.sell />} disabled={lines.length === 0 || state.running !== null} onClick={() => setChoosing('sell')}>
                        Продать
                    </MainActionButton>
                )}
                {state.editable && writeAction !== undefined && (
                    <MainActionButton icon={<Icons.hang />} disabled={lines.length === 0 || state.running !== null} onClick={() => setChoosing('hang')}>
                        Вывесить
                    </MainActionButton>
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
                    <MainActionButton
                        type="primary"
                        icon={<Icons.weigh />}
                        loading={state.running === weigh.name}
                        disabled={state.running !== null}
                        // Об отказе сообщили уведомление и ошибки полей, поэтому ошибка вызова здесь не обрабатывается.
                        onClick={() => state.run(weigh).catch(() => undefined)}
                    >
                        Отвесить
                    </MainActionButton>
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
