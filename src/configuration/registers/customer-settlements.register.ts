/**
 * Регистр «Расчёты с покупателями»: долг покупателя по документу-основанию и его оплаты.
 * Рассрочка и рассрочка по продаже записывают свою сумму и по движению с минусом на каждый
 * взнос. Итог по основанию равен непогашенному долгу, итог по смене равен непогашенному долгу
 * по её рассрочкам.
 *
 * Основание хранится полной ссылкой с видом документа: долг может создать документ любого вида.
 * Смена движения всегда равна смене основания: взнос, принятый в другую смену, относится к смене,
 * которая выдала рассрочку. Рассрочка считается её продажей, оплата которой растянута во времени.
 */
import { Effect } from 'effect';
import { register } from '../../server/metadata/index.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { Shift } from '../documents/shift.document.js';
import { rubles } from '../money.js';

/**
 * Ограничение `debt` задаёт предел взносов (раздел «Правила учёта»): итог по основанию
 * не уходит в минус, то есть взносы не превышают сумму рассрочки.
 */
export const CustomerSettlements = register('customerSettlements')
    .title('Расчёты с покупателями')
    .dimension('basis', (field) => field.reference().title('Основание').required())
    .dimension('person', (field) => field.reference(PhysicalPersons).title('Физическое лицо').required())
    .dimension('shift', (field) => field.reference(Shift).title('Смена').required())
    .resource('amount', (field) => field.money().title('Сумма').required())
    .constraint('debt', (constraint) => constraint
        .by(['basis'])
        .minimum('amount', 0)
        .message(({ totals }) => Effect.succeed(`Взносы превышают сумму рассрочки на ${rubles(-totals.amount)}`)));
