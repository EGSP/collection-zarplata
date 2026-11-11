/**
 * Купоны на форме продажи: кнопка «Применить купон», окно купона, компактная таблица применённых
 * купонов и значок купона у итога строки товара.
 *
 * Купон хранится в строке товара: акция, номер и копия процента или номинала (раздел «Правила
 * учёта», подраздел «Купон»). Таблица товаров эти колонки не выводит: продавец выбирает купон в окне, а не в ячейке.
 * Окно вызывает действие справочника «Применить купон»: оно проверяет срок акции, номер и число
 * применений и возвращает вид и размер акции, которые форма копирует в строку. Окончательно купоны
 * проверяет политика продажи при записи.
 */
import { createContext, useContext, useState } from 'react';
import { App, Flex, Form, Select, Tooltip, type FormInstance } from 'antd';
import { ActionDialog, Button, DataTable, Icons, Stack, TablePartTitle, useAction, useObjectView, useRecord, type FormValues, type InputProperties } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Строка товара на форме: до записи любая ячейка может быть пустой. */
interface GoodsLine {
    readonly name?: unknown;
    readonly cost?: unknown;
    readonly coupon?: unknown;
    readonly couponNumber?: unknown;
    readonly couponPercent?: unknown;
    readonly couponDenomination?: unknown;
}

/** Применённый купон: строка товара с акцией. Номер строки начинается с 1, как в таблице товаров. */
interface AppliedCoupon {
    readonly line: number;
    readonly coupon: string;
    readonly number: string;
    /** Размер скидки словами: «10 %» или «500,00 ₽». */
    readonly size: string;
    readonly goods: string;
}

/**
 * Ответ действия «Применить купон»: проверенная акция, номер в виде для сравнения, вид и размер акции.
 * У процентной акции заполнен `percentage`, у денежной `denomination` в копейках.
 */
interface CouponApplication {
    readonly coupon: string;
    readonly number: string;
    readonly kind: string;
    readonly percentage: number | null;
    readonly denomination: number | null;
    readonly goodsLine: number;
}

/**
 * Размер купона строки словами: «10 %», «12,5 %» или «500,00 ₽». Повторяет `couponSizeText`
 * из `coupons.ts`, который не импортируется, потому что это серверный модуль. Вид определяется
 * по заполненному номиналу: в строке товара вид не хранится.
 */
export const couponSizeText = (percent: unknown, denomination: unknown) => typeof denomination === 'number'
    ? `${(denomination / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`
    : `${(typeof percent === 'number' ? percent : 0).toLocaleString('ru-RU', { maximumFractionDigits: 2 })} %`;

/** Пустые поля купона строки товара: так строка остаётся без купона. */
const noCoupon = { coupon: null, couponNumber: null, couponPercent: null, couponDenomination: null };

/** Строки товаров формы: значение списка либо пустой список. */
const goodsLines = (goods: unknown): ReadonlyArray<GoodsLine> => Array.isArray(goods) ? goods as ReadonlyArray<GoodsLine> : [];

/** Название товара строки для списков окна и таблицы купонов. */
const goodsTitle = (line: GoodsLine, index: number) => `${index + 1}. ${typeof line.name === 'string' && line.name.trim() !== '' ? line.name : 'Без названия'}`;

/** Купоны строк товаров: только строки, где выбрана акция. */
const appliedCoupons = (goods: ReadonlyArray<GoodsLine>): ReadonlyArray<AppliedCoupon> => goods.flatMap((line, index) => typeof line.coupon === 'string'
    ? [{ line: index + 1, coupon: line.coupon, number: typeof line.couponNumber === 'string' ? line.couponNumber : '', size: couponSizeText(line.couponPercent, line.couponDenomination), goods: goodsTitle(line, index) }]
    : []);

/**
 * Варианты поля «Товар» окна купона. Поле стоит в отдельной форме окна и строки продажи читать
 * не может, поэтому они передаются контекстом: компонент поля должен иметь постоянный тип,
 * иначе окно пересоздавало бы ввод при каждой отрисовке.
 */
const GoodsOptionsContext = createContext<ReadonlyArray<{ readonly value: number; readonly label: string; readonly disabled: boolean }>>([]);

/** Выбор строки товара продажи по номеру. Строка, у которой уже есть купон, недоступна. */
function GoodsLineInput({ value, onChange, disabled, id }: InputProperties<unknown>) {
    const options = useContext(GoodsOptionsContext);
    return <Select {...id === undefined ? {} : { id }} value={typeof value === 'number' ? value : null} onChange={(line: number | null) => onChange?.(line)} disabled={disabled === true} options={[...options]} placeholder="Выберите товар" />;
}

/** Компоненты полей окна имеют постоянный тип. */
const fieldInputs = { goodsLine: GoodsLineInput };

/** Название акции по ссылке; пока запись не прочитана, вместо названия стоит многоточие. */
function CouponName({ coupon }: { readonly coupon: string }) {
    const name = useRecord(Objects.catalog.coupons, coupon).record?.['name'];
    return <>{typeof name === 'string' ? name : '…'}</>;
}

/**
 * Значок купона у итога строки товара. Подсказка называет акцию, размер купона и номер: в таблице
 * товаров колонок купона нет, и по значку продавец видит, почему итог меньше стоимости со скидкой.
 */
export function CouponMark({ line }: { readonly line: Record<string, unknown> }) {
    if (typeof line['coupon'] !== 'string') return null;
    const number = typeof line['couponNumber'] === 'string' ? line['couponNumber'] : '';
    return (
        <Tooltip title={<>Купон «<CouponName coupon={line['coupon']} />», {couponSizeText(line['couponPercent'], line['couponDenomination'])}, № {number}</>}>
            <Icons.coupon aria-label="Купон" />
        </Tooltip>
    );
}

/** Пометки таблицы товаров продажи: значок купона у итога строки. */
export const couponAdornments = { total: (line: Record<string, unknown>) => <CouponMark line={line} /> };

/** Свойства купонов продажи. */
interface SaleCouponsProperties {
    /** Форма продажи: купоны записываются в её строки товаров. */
    readonly form: FormInstance;
    /** Продажа, если она записана: её собственные применения не считаются чужими. */
    readonly sale: string | null;
    /** Форма только для просмотра: кнопок нет, таблица купонов только показывается. */
    readonly disabled: boolean;
}

/**
 * Кнопка «Применить купон» и таблица купонов продажи. Таблица показывается, только когда
 * применён хотя бы один купон. Строку меняют в том же окне, а удаляют кнопкой в строке:
 * удаление очищает купон в строке товара, и её итог возвращается к стоимости со скидкой.
 */
export function SaleCoupons({ form, sale, disabled }: SaleCouponsProperties) {
    const goods = goodsLines(Form.useWatch('goods', { form, preserve: true }));
    const date: unknown = Form.useWatch('date', { form, preserve: true });
    const action = useObjectView(Objects.catalog.coupons)?.form?.actions.find((item) => item.name === 'application');
    const execute = useAction();
    const { notification } = App.useApp();
    // Открытое окно: `null` — закрыто, `0` — новый купон, иначе номер строки изменяемого купона.
    const [editedLine, setEditedLine] = useState<number | null>(null);
    const coupons = appliedCoupons(goods);
    // Купон можно применить к строке с названием и стоимостью: до этого скидке не к чему относиться.
    const available = goods.some((line) => typeof line.coupon !== 'string' && typeof line.cost === 'number');
    if (coupons.length === 0 && (disabled || action === undefined || !available)) return null;

    /** Записывает купон в строку товара и очищает прежнюю строку, если купон перенесли на другой товар. */
    const apply = (application: CouponApplication) => {
        const lines = goodsLines(form.getFieldValue('goods')).map((line, index) => {
            // Копируется размер только своего вида: второе поле пусто, и итог строки считает его нулём.
            if (index + 1 === application.goodsLine) return { ...line, coupon: application.coupon, couponNumber: application.number, couponPercent: application.percentage, couponDenomination: application.denomination };
            if (index + 1 === editedLine) return { ...line, ...noCoupon };
            return line;
        });
        form.setFieldValue('goods', lines);
    };
    const remove = (line: number) => form.setFieldValue('goods', goodsLines(form.getFieldValue('goods')).map((item, index) => index + 1 === line ? { ...item, ...noCoupon } : item));

    const run = async (input: FormValues) => {
        const number = typeof input['number'] === 'string' ? input['number'].trim().toUpperCase() : '';
        // Повтор номера в этой же продаже сервер увидит только при записи: окно отклоняет его сразу.
        const repeated = coupons.some((item) => item.line !== editedLine && item.coupon === input['coupon'] && item.number === number);
        if (repeated) {
            notification.error({ message: 'Этот купон уже применён в продаже' });
            // Отказ оставляет окно открытым с введёнными данными, как отказ сервера.
            throw new Error('Купон уже применён в продаже');
        }
        const application = await execute<string, CouponApplication>({
            object: Objects.catalog.coupons,
            action: 'application',
            payload: { ...input, date: typeof date === 'string' ? date : null, sale },
            successMessage: 'Купон применён',
        });
        apply(application);
    };

    const options = goods.map((line, index) => ({
        value: index + 1,
        label: goodsTitle(line, index),
        // Изменяемый купон может остаться на своём товаре; строка без стоимости скидку не получит.
        disabled: (typeof line.coupon === 'string' && index + 1 !== editedLine) || typeof line.cost !== 'number',
    }));
    const edited = coupons.find((item) => item.line === editedLine);
    return (
        <Stack gap={3} align="stretch">
            {coupons.length > 0 && <>
                <TablePartTitle>Купоны</TablePartTitle>
                <DataTable<AppliedCoupon>
                    rows={coupons}
                    rowKey={(row) => row.line}
                    columns={[
                        { key: 'coupon', title: 'Акция', type: 'string', render: (row) => <CouponName coupon={row.coupon} /> },
                        { key: 'number', title: 'Номер', type: 'string', value: (row) => row.number },
                        { key: 'goods', title: 'Товар', type: 'string', size: { minimum: 16, weight: 2 }, value: (row) => row.goods },
                        { key: 'size', title: 'Скидка', type: 'string', value: (row) => row.size },
                        ...disabled || action === undefined ? [] : [{
                            key: 'actions', title: '', type: 'free' as const, size: { minimum: 10 },
                            render: (row: AppliedCoupon) => (
                                <Flex gap={4}>
                                    <Button type="text" icon={<Icons.edit />} aria-label="Изменить купон" onClick={() => setEditedLine(row.line)} />
                                    <Button type="text" icon={<Icons.removeRow />} aria-label="Удалить купон" onClick={() => remove(row.line)} />
                                </Flex>
                            ),
                        }],
                    ]}
                />
            </>}
            {!disabled && action !== undefined && available && <div><Button icon={<Icons.coupon />} onClick={() => setEditedLine(0)}>Применить купон</Button></div>}
            {editedLine !== null && action !== undefined && (
                <GoodsOptionsContext.Provider value={options}>
                    <ActionDialog
                        // Дату и продажу подставляет форма: продавец их не вводит.
                        action={{ ...action, input: action.input.filter((field) => field.name !== 'date' && field.name !== 'sale') }}
                        fieldInputs={fieldInputs}
                        initialValues={edited === undefined ? undefined : { coupon: edited.coupon, number: edited.number, goodsLine: edited.line }}
                        onExecute={run}
                        onClose={() => setEditedLine(null)}
                    />
                </GoodsOptionsContext.Provider>
            )}
        </Stack>
    );
}
