/**
 * Пробный регистр для проверки проведения, пока в конфигурации нет прикладных регистров.
 * Его строки записывает пробный документ. Ограничение показывает правило «остаток не уходит
 * в минус»: документ с отрицательным количеством проводится, только пока итог по элементу
 * остаётся неотрицательным. Составные измерения повторяют поля шапки документа: по ним итог
 * группируется с учётом типа значения. Удаляется, когда появятся настоящие регистры.
 */
import { Effect } from 'effect';
import { register } from '../../server/metadata/index.js';
import { Sample } from '../catalogs/sample.catalog.js';

export const SampleRegister = register('sample')
    .title('Пробный регистр')
    .dimension('item', (field) => field.reference(Sample).title('Элемент справочника').required())
    .dimension('receiver', (field) => field.composite([field.string().maximumLength(200), field.reference(Sample)]).title('Куда оплачено'))
    .dimension('mark', (field) => field.composite([field.string().maximumLength(50), field.number(), field.reference(Sample)]).title('Отметка'))
    .resource('quantity', (field) => field.number().title('Количество').required())
    .resource('amount', (field) => field.money().title('Сумма').required())
    .constraint('stock', (constraint) => constraint
        .by(['item'])
        .minimum('quantity', 0)
        .message(({ totals }) => Effect.succeed(`Количество по элементу справочника уходит в минус на ${-totals.quantity}`)));
