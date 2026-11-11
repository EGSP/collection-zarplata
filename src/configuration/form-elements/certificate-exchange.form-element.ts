/**
 * Объявление элемента формы сертификата: кнопка «Обменять на деньги» и её окно.
 * Компонент лежит в соседнем файле `certificate-exchange.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/**
 * Места подключения компонента; сервер проверяет их до запуска приложения. Кнопка стоит после
 * строк обмена, последним блоком формы: главное действие формы находится внизу, как
 * «Внести изменения» у продажи.
 */
export const CertificateExchange = defineFormComponent({
    name: 'certificateExchange',
    attachments: [
        { insert: { object: Objects.document.certificate, group: 'Остаток', after: 'exchanges' } },
    ],
});
