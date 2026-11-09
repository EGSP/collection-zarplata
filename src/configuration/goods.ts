/**
 * Товары: общая табличная часть продажи, отвеса и возврата. Колонки и формула итога
 * объявлены один раз, поэтому строка, скопированная из одного документа в другой, считается
 * в обоих одинаково.
 */
import { formula, tablePart } from '../server/metadata/index.js';
import { Coupons } from './catalogs/coupons.catalog.js';
import { Discounts } from './catalogs/discounts.catalog.js';

/** Процент поля строки в целых сотых долях: пустое поле формула считает нулём. */
const hundredths = (name: string) => formula.round(formula.multiply(formula.field(name), formula.value(100)));

/**
 * Итог строки: стоимость, уменьшенная на процент скидки и процент купона, с округлением
 * до копейки (раздел «Правила учёта»). Проценты складываются: купон даёт скидку от стоимости,
 * а не от цены после скидки. Проценты сначала переводятся в целые сотые доли: тогда до деления
 * все числа целые, и половина копейки получается точно, а не числом чуть меньше половины,
 * которое округлилось бы вниз.
 */
const total = formula.round(formula.divide(
    formula.multiply(formula.field('cost'), formula.subtract(formula.subtract(formula.value(10000), hundredths('discount')), hundredths('couponPercent'))),
    formula.value(10000),
));

/**
 * Колонки товара: сначала код, затем название, в том числе при просмотре товаров продажи в возврате.
 * Оба значения остаются текстом, без ссылки на номенклатуру; код сохраняет ведущие нули.
 */
export const Goods = tablePart((part) => part
    .field('code', (field) => field.string().title('Код').maximumLength(50))
    .field('name', (field) => field.string().title('Название').required().maximumLength(300))
    // Размер — текст, а не число: у колец, цепочек и браслетов он записывается по-разному.
    .field('size', (field) => field.string().title('Размер').maximumLength(50))
    .field('comment', (field) => field.string().title('Комментарий').maximumLength(500))
    .field('postedIn1C', (field) => field.boolean().title('Проведено в 1С'))
    .field('cost', (field) => field.money().title('Стоимость').minimum(0).required())
    .field('discount', (field) => field.number().title('Скидка, %').minimum(0).maximum(100).suggestions(Discounts, 'percentage'))
    // Купон хранится в строке товара, к которой применён: у товара не больше одного купона.
    // Процент копируется из акции при применении, чтобы итог проведённой продажи не менялся
    // при правке акции. Возврат копирует все три поля из строки продажи.
    .field('coupon', (field) => field.reference(Coupons).title('Купон'))
    .field('couponNumber', (field) => field.string().title('Номер купона').maximumLength(50))
    .field('couponPercent', (field) => field.number().title('Купон, %').minimum(0).maximum(100))
    .field('total', (field) => field.money().title('Итог').required().computed(total)));
