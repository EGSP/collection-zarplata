import { Flex, Typography } from 'antd';
import { useEffect } from 'react';
import { FieldDisplay, RecordTable, useFormData, useFormRestrictions, useFormValue, useObjectView, useRecordList } from '../../web/sdk';
import { Objects } from '../objects.generated';

/** Вид купленного сертификата; совпадает с `purchasedCertificate` из `certificate.document.ts`. */
const purchasedCertificate = 'Куплен';

/**
 * Состояние сертификата на его форме и история движений по нему.
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
 * - обменянный сертификат служит только для просмотра: изменить номинал политика уже не даст;
 * - стандартная кнопка обмена скрыта: её заменяет элемент `certificateExchange` внизу формы.
 */
export default function CertificateState() {
    const certificates = Objects.document.certificate;
    const form = useFormData(certificates);
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
    // У нового сертификата состояния и движений ещё нет.
    if (saved === null) return null;

    const state = !saved.posted ? 'Не проведён' : exchanged ? 'Обменян на деньги' : saved.balance > 0 ? 'Действует' : 'Израсходован';
    return (
        <Flex vertical gap="small">
            <Typography.Text strong>
                {state}
                {exchanged && <> <FieldDisplay field={{ kind: 'dateTime', target: null }} value={saved.exchangedAt} /></>}
            </Typography.Text>
            {saved.posted && <CertificateMovements certificate={saved.guid} />}
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
