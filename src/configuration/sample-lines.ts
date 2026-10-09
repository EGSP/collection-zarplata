import { formula, tablePart } from '../server/metadata/index.js';
import { Sample } from './catalogs/sample.catalog.js';

/** Общие колонки пробных документов; сумма после скидки хранится в целых копейках. */
export const SampleLines = tablePart((part) => part
    .field('item', (field) => field.reference(Sample).title('Элемент справочника').required())
    .field('quantity', (field) => field.number().title('Количество').minimum(0).required())
    .field('amount', (field) => field.money().title('Сумма').minimum(0).required())
    .field('discount', (field) => field.number().title('Скидка, %').minimum(0).maximum(100).suggestions(Sample, 'percentage'))
    .field('netAmount', (field) => field.money().title('После скидки').required().computed(formula.round(formula.multiply(formula.field('amount'), formula.subtract(formula.value(1), formula.divide(formula.field('discount'), formula.value(100))))))));
