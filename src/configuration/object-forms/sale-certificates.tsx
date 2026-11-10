/**
 * Сертификаты на форме продажи: кнопка «Оплатить сертификатом», окно сертификата и компактная
 * таблица строк оплаты сертификатами.
 *
 * Строки хранятся табличной частью продажи `certificates`: сертификат и списываемая сумма
 * (раздел «Правила учёта», подраздел «Сертификат»). Таблица описания формы скрыта: продавец
 * выбирает сертификат в окне, а не в ячейке. Окно вызывает действие сертификата «Оплатить
 * сертификатом»: оно проверяет проведение и остаток без движений этой продажи. Окончательно
 * строки проверяет политика продажи при записи.
 */
import { useState } from 'react';
import { App, Flex, Form, type FormInstance } from 'antd';
import { ActionDialog, Button, DataTable, FieldDisplay, FieldInput, Icons, RecordLink, Stack, TablePartTitle, Text, useAction, useObjectView, useRecord, type FormValues, type InputProperties } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Строка сертификата на форме: до записи ячейки могут быть пустыми. */
interface CertificateFormLine {
    readonly certificate?: unknown;
    readonly amount?: unknown;
}

/** Заполненная строка сертификата. Номер строки начинается с 1, как в таблице. */
interface CertificateRow {
    readonly line: number;
    readonly certificate: string;
    readonly amount: number;
}

/** Ответ действия «Оплатить сертификатом»: проверенный сертификат, сумма и его остаток. */
interface CertificateApplication {
    readonly certificate: string;
    readonly amount: number;
    readonly balance: number;
}

/** Строки сертификатов формы: значение списка либо пустой список. */
export const certificateLines = (value: unknown): ReadonlyArray<CertificateFormLine> => Array.isArray(value) ? value as ReadonlyArray<CertificateFormLine> : [];

/** Сумма оплаты сертификатами: сумма заполненных строк. */
export const certificatesTotal = (value: unknown) => certificateLines(value).reduce((total, line) => total + (typeof line.amount === 'number' ? line.amount : 0), 0);

/** Заполненные строки: сертификат выбран, сумма введена. */
const certificateRows = (value: unknown): ReadonlyArray<CertificateRow> => certificateLines(value).flatMap((line, index) => typeof line.certificate === 'string' && typeof line.amount === 'number'
    ? [{ line: index + 1, certificate: line.certificate, amount: line.amount }]
    : []);

/**
 * Поле выбора сертификата с остатком под ним. Представление сертификата остатка не содержит:
 * остаток нужен только при выборе, чтобы продавец видел, сколько можно списать. Остаток читается
 * из записи сертификата и обновляется при выборе другого.
 */
function CertificateInput(properties: InputProperties<unknown>) {
    const certificate = typeof properties.value === 'string' ? properties.value : null;
    const balance = useRecord(Objects.document.certificate, certificate).record?.balance;
    return (
        <Stack gap={2} align="stretch">
            <FieldInput {...properties} />
            {certificate !== null && typeof balance === 'number' && (
                <Text.Helper>Остаток: <FieldDisplay field={{ kind: 'money', target: null }} value={balance} /></Text.Helper>
            )}
        </Stack>
    );
}

/** Компонент поля имеет постоянный тип, чтобы окно не пересоздавало ввод при каждой отрисовке. */
const fieldInputs = { certificate: CertificateInput };

/** Свойства сертификатов продажи. */
interface SaleCertificatesProperties {
    /** Форма продажи: строки записываются в её табличную часть `certificates`. */
    readonly form: FormInstance;
    /** Продажа, если она записана: её собственное списание возвращается в остаток сертификата. */
    readonly sale: string | null;
    /** Сумма продажи: окно предлагает оплатить сертификатом её непокрытую часть. */
    readonly amount: number;
    /** Форма только для просмотра: кнопок нет, таблица только показывается. */
    readonly disabled: boolean;
}

/**
 * Кнопка «Оплатить сертификатом» и таблица сертификатов продажи. Таблица показывается, только
 * когда указан хотя бы один сертификат. Строку меняют в том же окне, а удаляют кнопкой в строке.
 * Кнопки нет, пока сумма продажи нулевая или уже покрыта сертификатами.
 */
export function SaleCertificates({ form, sale, amount, disabled }: SaleCertificatesProperties) {
    const value: unknown = Form.useWatch('certificates', { form, preserve: true });
    const action = useObjectView(Objects.document.certificate)?.form?.actions.find((item) => item.name === 'application');
    const execute = useAction();
    const { notification } = App.useApp();
    // Открытое окно: `null` — закрыто, `0` — новый сертификат, иначе номер строки изменяемого.
    const [editedLine, setEditedLine] = useState<number | null>(null);
    const rows = certificateRows(value);
    const covered = certificatesTotal(value);
    const editable = !disabled && action !== undefined;
    const available = editable && amount > covered;
    if (rows.length === 0 && !available) return null;

    const remove = (line: number) => form.setFieldValue('certificates', certificateLines(form.getFieldValue('certificates')).filter((_item, index) => index + 1 !== line));

    const run = async (input: FormValues) => {
        // Повтор сертификата в этой же продаже сервер увидит только при записи: окно отклоняет его сразу.
        if (rows.some((row) => row.line !== editedLine && row.certificate === input['certificate'])) {
            notification.error({ message: 'Этот сертификат уже указан в продаже' });
            // Отказ оставляет окно открытым с введёнными данными, как отказ сервера.
            throw new Error('Сертификат уже указан в продаже');
        }
        const application = await execute<string, CertificateApplication>({
            object: Objects.document.certificate,
            action: 'application',
            payload: { ...input, sale },
            successMessage: 'Сертификат добавлен в оплату',
        });
        const line = { certificate: application.certificate, amount: application.amount };
        const lines = certificateLines(form.getFieldValue('certificates'));
        form.setFieldValue('certificates', editedLine === 0 || editedLine === null ? [...lines, line] : lines.map((item, index) => index + 1 === editedLine ? line : item));
    };

    const edited = rows.find((row) => row.line === editedLine);
    // Новая строка предлагает непокрытую часть продажи: чаще всего сертификат оплачивает всё, что может.
    const initialValues = edited === undefined ? (amount > covered ? { amount: amount - covered } : undefined) : { certificate: edited.certificate, amount: edited.amount };
    return (
        <Stack gap={3} align="stretch">
            {rows.length > 0 && <>
                <TablePartTitle>Сертификаты</TablePartTitle>
                <DataTable<CertificateRow>
                    rows={rows}
                    rowKey={(row) => row.line}
                    columns={[
                        { key: 'certificate', title: 'Сертификат', type: 'free', size: { minimum: 16, weight: 2 }, render: (row) => <RecordLink reference={{ kind: Objects.document.certificate.kind, name: Objects.document.certificate.name, guid: row.certificate }} /> },
                        { key: 'amount', title: 'Сумма', type: 'money', value: (row) => row.amount },
                        ...!editable ? [] : [{
                            key: 'actions', title: '', type: 'free' as const, size: { minimum: 10 },
                            render: (row: CertificateRow) => (
                                <Flex gap={4}>
                                    <Button type="text" icon={<Icons.edit />} aria-label="Изменить сертификат" onClick={() => setEditedLine(row.line)} />
                                    <Button type="text" icon={<Icons.removeRow />} aria-label="Удалить сертификат" onClick={() => remove(row.line)} />
                                </Flex>
                            ),
                        }],
                    ]}
                />
            </>}
            {available && <div><Button icon={<Icons.certificate />} onClick={() => setEditedLine(0)}>Оплатить сертификатом</Button></div>}
            {editedLine !== null && action !== undefined && (
                <ActionDialog
                    // Продажу подставляет форма: продавец её не вводит.
                    action={{ ...action, input: action.input.filter((field) => field.name !== 'sale') }}
                    fieldInputs={fieldInputs}
                    initialValues={initialValues}
                    onExecute={run}
                    onClose={() => setEditedLine(null)}
                />
            )}
        </Stack>
    );
}
