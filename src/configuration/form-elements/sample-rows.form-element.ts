import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Места подключения компонента; сервер проверяет их до запуска приложения. */
export const SampleRows = defineFormComponent({
    name: 'sampleRows',
    insert: { object: Objects.document.sampleSelection, group: 'Основное', after: 'total' },
});
