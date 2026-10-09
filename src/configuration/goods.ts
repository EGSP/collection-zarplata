/**
 * Товары: общая табличная часть продажи, рассрочки, отвеса и возврата. Колонки и формула итога
 * объявлены один раз, поэтому строка, скопированная из одного документа в другой, считается
 * в обоих одинаково.
 */
import { formula, tablePart } from '../server/metadata/index.js';
import { Discounts } from './catalogs/discounts.catalog.js';

/**
 * Итог строки: стоимость, уменьшенная на процент скидки, с округлением до копейки (раздел
 * «Правила учёта»). Процент сначала переводится в целые сотые доли: тогда до деления все числа
 * целые, и половина копейки получается точно, а не числом чуть меньше половины, которое
 * округлилось бы вниз.
 */
const total = formula.round(formula.divide(
    formula.multiply(formula.field('cost'), formula.subtract(formula.value(10000), formula.round(formula.multiply(formula.field('discount'), formula.value(100))))),
    formula.value(10000),
));

/** Колонки товара. Название остаётся текстом: ссылки на номенклатуру в первой редакции нет. */
export const Goods = tablePart((part) => part
    .field('name', (field) => field.string().title('Название').required().maximumLength(300))
    .field('cost', (field) => field.money().title('Стоимость').minimum(0).required())
    .field('discount', (field) => field.number().title('Скидка, %').minimum(0).maximum(100).suggestions(Discounts, 'percentage'))
    .field('total', (field) => field.money().title('Итог').required().computed(total)));
