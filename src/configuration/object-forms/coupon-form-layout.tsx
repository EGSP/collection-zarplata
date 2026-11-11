import { Form } from 'antd';
import { DataTable, RecordFormLayout, RecordFormPage, RecordLink, Stack, TablePartTitle, Text, useFunctionResult, useRecordForm, type FormValues, type NewFormProperties, type RecordFormOptions, type RecordFormProperties, type RecordFormState } from '../../web/sdk';
import { Objects } from '../objects.generated';

/**
 * Виды купона. Совпадают с `percentageCoupon` и `amountCoupon` из `coupons.ts`; константы оттуда
 * не импортируются, потому что это серверный модуль, а форма собирается в клиент.
 */
const percentageCoupon = 'Процент';
const amountCoupon = 'Сумма';

/** Поле размера скидки, которое к виду не относится: при «Проценте» номинал, при «Сумме» процент. */
function foreignField(kind: unknown): string | null {
    if (kind === percentageCoupon) return 'denomination';
    if (kind === amountCoupon) return 'percentage';
    return null;
}

/**
 * Очищает поле чужого вида перед записью. Пока продавец выбирает вид, значение скрытого поля
 * остаётся в форме: при возврате к прежнему виду введённое число не теряется. Записывается же
 * только поле своего вида, потому что политика купона отклоняет заполненное поле чужого вида.
 */
function beforeSave(values: FormValues): FormValues | undefined {
    const foreign = foreignField(values['kind']);
    if (foreign === null || values[foreign] === null || values[foreign] === undefined) return undefined;
    return { ...values, [foreign]: null };
}

const couponFormOptions: RecordFormOptions = { beforeSave };

/**
 * Раскладка формы купона: стандартные группы без поля размера чужого вида. При виде «Процент»
 * скрыт «Номинал», при виде «Сумма» скрыт «Процент». Без выбранного вида видны оба поля.
 * Поле убирается из группы, а не из формы: значение формы для него остаётся, и `beforeSave`
 * очищает его при записи.
 */
function CouponFormLayout({ state }: { readonly state: RecordFormState }) {
    const kind: unknown = Form.useWatch('kind', { form: state.form, preserve: true });
    const foreign = foreignField(kind ?? state.record?.['kind'] ?? null);
    const groups = foreign === null ? state.view.groups : state.view.groups.map((group) => ({ ...group, elements: group.elements.filter((element) => element !== foreign) }));
    return (
        <RecordFormPage state={state}>
            <RecordFormLayout state={state} groups={groups} />
            {state.record !== null && <CouponApplications coupon={String(state.record['guid'])} />}
        </RecordFormPage>
    );
}

/** Строка применения из функции `applications` справочника купонов. */
interface ApplicationRow {
    readonly number: string;
    readonly date: string;
    readonly sale: string;
}

/**
 * Блок «Применения» под группами формы существующего купона: сколько купонов применено и осталось,
 * и таблица применений с номером купона, датой и продажей. Блок только показывает данные:
 * их считает функция справочника по регистру «Применённые купоны», то есть по проведённым продажам.
 * По этим же данным политика купона запрещает менять размер и уменьшать количество.
 * Без права на функцию или до ответа сервера блок не выводится.
 */
function CouponApplications({ coupon }: { readonly coupon: string }) {
    const result = useFunctionResult({ object: Objects.catalog.coupons, name: 'applications', payload: { coupon } });
    if (result.data === undefined) return null;
    const { used, remaining, applications } = result.data;
    return (
        <Stack gap={3} align="stretch">
            <TablePartTitle>Применения</TablePartTitle>
            <Text>Применено: {used}, осталось: {remaining}</Text>
            <DataTable<ApplicationRow>
                rows={applications}
                rowKey={(row) => `${row.sale}/${row.number}`}
                emptyText="Купон ещё не применялся"
                columns={[
                    { key: 'number', title: 'Номер купона', type: 'string', value: (row) => row.number },
                    { key: 'date', title: 'Дата применения', type: 'dateTime', value: (row) => row.date },
                    { key: 'sale', title: 'Продажа', type: 'free', size: { minimum: 24, weight: 1 }, render: (row) => <RecordLink reference={{ kind: Objects.document.sale.kind, name: Objects.document.sale.name, guid: row.sale }} /> },
                ]}
            />
        </Stack>
    );
}

/** Форма существующего купона. Поведение формы стандартное, меняется только состав полей. */
export function CouponRecordForm(properties: RecordFormProperties) {
    return <CouponFormLayout state={useRecordForm(properties, couponFormOptions)} />;
}

/** Форма нового купона с той же раскладкой; открывается и в окне создания. */
export function CouponNewForm(properties: NewFormProperties) {
    return <CouponFormLayout state={useRecordForm(properties, couponFormOptions)} />;
}
