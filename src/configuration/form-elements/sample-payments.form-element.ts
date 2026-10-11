import { defineFormComponent } from '../../server/metadata/form-elements.js';
import { Objects } from '../objects.generated.js';

/** Замена таблицы оплаты пробного документа; часть остаётся в раскладке формы. */
export const SamplePayments = defineFormComponent({
    name: 'samplePayments',
    override: { object: Objects.document.sample, tablePart: 'payments' },
});
