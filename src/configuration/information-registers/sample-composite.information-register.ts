/** Пробные сведения с составными полями: измерение в ключе и ресурс разных типов. */
import { informationRegister } from '../../server/metadata/index.js';
import { Sample } from '../catalogs/sample.catalog.js';

/**
 * Ключом служит значение любого из трёх типов: строка «100», число 100 и ссылка на запись
 * дают разные записи. Ресурс хранит строку либо сумму.
 */
export const SampleCompositeInformation = informationRegister('sampleComposite')
    .title('Пробные сведения с составным ключом')
    .dimension('subject', (field) => field.composite([field.string().maximumLength(100), field.number(), field.reference(() => Sample)]).title('Предмет'))
    .resource('value', (field) => field.composite([field.string().maximumLength(200), field.money()]).title('Значение'));
