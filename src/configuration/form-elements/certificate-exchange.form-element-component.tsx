import { useState } from 'react';
import { Icons, MainActionButton, useFormData } from '../../web/sdk';
import { Objects } from '../objects.generated';
import { InstallmentPaymentDialog } from '../object-forms/installment-payment-dialog';

/** Вид купленного сертификата; совпадает с `purchasedCertificate` из `certificate.document.ts`. */
const purchasedCertificate = 'Куплен';

/**
 * Кнопка «Обменять на деньги» внизу формы сертификата и окно обмена.
 *
 * Стандартная кнопка обмена скрыта (её скрывает элемент `certificateState`): действие принимает
 * сертификат во входных данных, и стандартное окно потребовало бы выбрать его вручную. Эта кнопка
 * передаёт `guid` открытой записи сама, а в окне оставляет способ и «Откуда выдано»; приёмник
 * по способу подставляет то же окно, что у взноса рассрочки.
 *
 * Кнопка есть только у проведённого купленного сертификата, который ещё не обменян и остаток
 * которого равен номиналу. Движения других документов, взаимно погасившие друг друга, проверяет сервер.
 * Обмен — главное действие такой формы, поэтому кнопка выглядит как «Внести изменения» продажи,
 * а значок у неё тот же, что у возврата: деньги за сертификат возвращаются покупателю.
 */
export default function CertificateExchange() {
    const certificates = Objects.document.certificate;
    const form = useFormData(certificates);
    const [exchanging, setExchanging] = useState(false);
    const saved = form.saved;
    const exchange = form.view.actions.find((action) => action.name === 'exchange');
    if (saved === null || exchange === undefined) return null;
    const canExchange = saved.posted && saved.exchangedAt === null && saved.kind === purchasedCertificate && saved.balance === saved.denomination;
    if (!canExchange) return null;
    return (
        // Обёртка не даёт раскладке группы растянуть кнопку на всю ширину.
        <div>
            <MainActionButton type="primary" icon={<Icons.exchangeCertificate />} onClick={() => setExchanging(true)}>{exchange.title}</MainActionButton>
            {exchanging && (
                <InstallmentPaymentDialog
                    action={{ ...exchange, input: exchange.input.filter((field) => field.name !== 'certificate') }}
                    onExecute={async (input) => {
                        await form.runAction('exchange', { ...input, certificate: saved.guid });
                    }}
                    onClose={() => setExchanging(false)}
                />
            )}
        </div>
    );
}
