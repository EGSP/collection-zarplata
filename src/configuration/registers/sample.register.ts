/**
 * Пробный регистр для проверки проведения, пока в конфигурации нет прикладных регистров.
 * Его строки записывает пробный документ. Удаляется, когда появятся настоящие регистры.
 */
import { register } from '../../server/metadata/index.js';
import { Sample } from '../catalogs/sample.catalog.js';

export const SampleRegister = register('sample')
    .title('Пробный регистр')
    .dimension('item', (field) => field.reference(Sample).title('Элемент справочника').required())
    .resource('quantity', (field) => field.number().title('Количество').required())
    .resource('amount', (field) => field.money().title('Сумма').required());
