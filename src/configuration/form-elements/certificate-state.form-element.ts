/**
 * Объявление элемента формы сертификата: состояние, история движений и обмен на деньги.
 * Компонент лежит в соседнем файле `certificate-state.form-element-component.tsx`.
 */
import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const CertificateState = defineFormComponent({
    name: 'certificateState',
    attachments: [
        { insert: { object: Objects.document.certificate, group: 'Остаток', after: 'balance' } },
    ],
});
