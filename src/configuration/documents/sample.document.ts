/**
 * Пробный документ для проверки платформы, пока в конфигурации нет прикладных документов.
 * Ссылается на пробный справочник в шапке и в табличной части. Удаляется, когда появятся
 * настоящие документы.
 */
import { document } from '../../server/metadata/index.js';
import { Sample } from '../catalogs/sample.catalog.js';

export const SampleDocument = document('sample')
    .title('Пробный документ')
    .field('item', (field) => field.reference(Sample).title('Элемент справочника').required())
    .field('comment', (field) => field.string().title('Комментарий').maximumLength(500))
    .tablePart('lines', (part) => part
        .title('Строки')
        .field('item', (field) => field.reference(Sample).title('Элемент справочника').required())
        .field('quantity', (field) => field.number().title('Количество').minimum(0).required())
        .field('amount', (field) => field.money().title('Сумма').minimum(0).required()));
