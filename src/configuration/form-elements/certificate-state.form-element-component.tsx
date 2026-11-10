import { Button, Flex, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { FieldDisplay, RecordTable, useFormData, useFormRestrictions, useFormValue, useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { InstallmentPaymentDialog } from '../object-forms/installment-payment-dialog';

/** Вид купленного сертификата; совпадает с `purchasedCertificate` из `certificate.document.ts`. */
const purchasedCertificate = 'Куплен';

/**
 * Состояние сертификата на его форме, история движений по нему и кнопка «Обменять на деньги».
 *
 * Состояние в документе не хранится и выводится из записанного сертификата: «Не проведён»,
 * «Обменян на деньги», «Действует» при остатке больше нуля, иначе «Израсходован». История — движения
 * регистра «Остатки сертификатов» по сертификату: выдача, оплаты продаж, пополнения возвратами
 * и обмен, со ссылками на документы. Это и есть пометка о продаже, в которой сертификат применили.
 *
 * Элемент управляет формой:
 * - строки обмена недоступны для изменения: их заполняет только действие «Обменять на деньги»;
 * - у сертификата «Выдан без оплаты» способ оплаты и «Куда оплачено» очищаются и недоступны:
 *   политика сертификата отклонила бы запись с ними;
 * - обменянный сертификат служит только для просмотра: изменить номинал политика уже не даст.
 *
 * Стандартная кнопка обмена скрыта: действие принимает сертификат во входных данных, и стандартное
 * окно потребовало бы выбрать его вручную. Кнопка элемента передаёт `guid` открытой записи сама,
 * а в окне оставляет способ и «Откуда выдано»; приёмник по способу подставляет то же окно, что
 * у взноса рассрочки. Кнопка есть только у проведённого купленного сертификата, остаток которого
 * равен номиналу. Движения других документов, взаимно погасившие друг друга, проверяет сервер.
 */
export default function CertificateState() {
    const certificates = Objects.document.certificate;
    const form = useFormData(certificates);
    const [exchanging, setExchanging] = useState(false);
    const kind = useFormValue(certificates, 'kind');
    const paymentMethod = useFormValue(certificates, 'paymentMethod');
    const receiver = useFormValue(certificates, 'receiver');
    const free = kind !== null && kind !== purchasedCertificate;
    const saved = form.saved;
    const exchanged = (saved?.exchangedAt ?? null) !== null;
    useEffect(() => {
        if (free && paymentMethod !== null) form.setValue('paymentMethod', null);
        if (free && receiver !== null) form.setValue('receiver', null);
    }, [free, paymentMethod, receiver, form]);
    useFormRestrictions(certificates, exchanged
        ? { readOnly: true, hiddenActions: ['exchange'] }
        : { readOnlyFields: free ? ['exchanges', 'paymentMethod', 'receiver'] : ['exchanges'], hiddenActions: ['exchange'] });
    // У нового сертификата состояния и движений ещё нет, а действию нужен `guid` записанного.
    if (saved === null) return null;

    const exchange = form.view.actions.find((action) => action.name === 'exchange');
    const canExchange = saved.posted && !exchanged && saved.kind === purchasedCertificate && saved.balance === saved.denomination;
    const state = !saved.posted ? 'Не проведён' : exchanged ? 'Обменян на деньги' : saved.balance > 0 ? 'Действует' : 'Израсходован';
    return (
        <Flex vertical gap="small">
            <Flex align="center" gap="middle" wrap>
                <Typography.Text strong>
                    {state}
                    {exchanged && <> <FieldDisplay field={{ kind: 'dateTime', target: null }} value={saved.exchangedAt} /></>}
                </Typography.Text>
                {canExchange && exchange !== undefined && <Button onClick={() => setExchanging(true)}>{exchange.title}</Button>}
            </Flex>
            {saved.posted && <CertificateMovements certificate={saved.guid} />}
            {exchanging && exchange !== undefined && (
                <InstallmentPaymentDialog
                    action={{ ...exchange, input: exchange.input.filter((field) => field.name !== 'certificate') }}
                    onExecute={async (input) => {
                        await form.runAction('exchange', { ...input, certificate: saved.guid });
                    }}
                    onClose={() => setExchanging(false)}
                />
            )}
        </Flex>
    );
}

/**
 * История движений сертификата по времени. Чтение монтируется только у проведённого сертификата
 * и только при праве читать регистр: без права история не выводится, а остаток виден в поле формы.
 */
function CertificateMovements({ certificate }: { readonly certificate: string }) {
    const register = useObjectView(Objects.register.certificateBalances);
    if (register === undefined) return null;
    return <MovementsTable certificate={certificate} />;
}

function MovementsTable({ certificate }: { readonly certificate: string }) {
    const balances = Objects.register.certificateBalances;
    const list = useRecordList(balances, {
        permanentFilter: [{ field: 'certificate', operator: 'equals', value: certificate }],
        sort: [{ field: 'period', direction: 'ascending' }],
    });
    return <RecordTable object={balances} list={list} columns={['period', 'recorder', 'amount']} />;
}
