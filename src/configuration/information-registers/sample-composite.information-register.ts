/** Пробные сведения с составными полями: измерение в ключе и ресурс разных типов. */
import { informationRegister } from '../../server/metadata/index.js';
import { Sample } from '../catalogs/sample.catalog.js';

/**
 * Ключом служит значение любого из трёх типов: строка «100», число 100 и ссылка на запись
 * дают разные записи. Ресурс хранит строку либо сумму; оба его варианта вводятся текстом,
 * но конфигурация требует сначала выбрать тип, чтобы сумму не приняли за строку.
 */
export const SampleCompositeInformation = informationRegister('sampleComposite')
    .title('Пробные сведения с составным ключом')
    .dimension('subject', (field) => field.composite([field.string().maximumLength(100), field.number(), field.reference(() => Sample)]).title('Предмет'))
    .resource('value', (field) => field.composite([field.string().maximumLength(200), field.money()]).inputMode('solid').title('Значение'));
