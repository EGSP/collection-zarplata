/**
 * Отвес: товар, отложенный для покупателя. Каждая строка товара находится в одном из трёх
 * состояний: «В отвесе», «Продано» или «Вывешено». Отвес закрыт, когда строк «В отвесе»
 * не осталось; отдельного действия закрытия нет.
 *
 * Строка хранит состояние и необязательную ссылку на продажу двумя полями. Остаток и число
 * товаров в отвесе хранятся вычисляемыми полями шапки: по ним блок незакрытых отвесов отбирает
 * документы, не читая их строки.
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { selectTyped } from '../../server/data/typed-select.js';
import { Database } from '../../server/database/database.effect.js';
import { document, formula, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
import { OpenShift } from '../form-elements/open-shift.form-element.js';
import { WeighingState } from '../form-elements/weighing-state.form-element.js';
import { Goods } from '../goods.js';
import { Sale } from './sale.document.js';
import { Shift } from './shift.document.js';

const held = 'В отвесе';
const sold = 'Продано';
const hung = 'Вывешено';

const inWeighing = { field: 'state', equals: held };

/**
 * Описание без политики и действия. Они читают и записывают сам отвес, а ссылка на `Weighing`
 * из его же объявления не дала бы вывести тип.
 */
const weighing = document('weighing')
    .title('Отвес')
    .field('shift', (field) => field.reference(Shift).title('Смена').required())
    .field('person', (field) => field.reference(PhysicalPersons).title('Физическое лицо').required())
    .field('balance', (field) => field.money().title('Остаток').required().computed(formula.sum('goods', 'total', inWeighing)))
    // Признак закрытия: остаток для него не годится, потому что товар в отвесе может стоить ноль.
    .field('heldCount', (field) => field.number().title('Товаров в отвесе').integer().required().computed(formula.count('goods', inWeighing)))
    .tablePart('goods', (part) => part
        .title('Товары')
        .include(Goods)
        .field('state', (field) => field.string().title('Состояние').choices([held, sold, hung]).initial(held).required())
        // Продажа ссылается на отвес как на основание, поэтому файлы импортируют друг друга по кругу.
        // Тип результата указан явно: иначе тип отвеса выводился бы через тип продажи и обратно.
        .field('sale', (field) => field.reference((): ObjectTarget => Sale).title('Продажа')))
    .listTableParts(['goods']);

type WeighingRecord = RecordOf<typeof weighing>;

const rejected = (message: string) => new DataPolicyError({ message });

/**
 * Правила строк отвеса (раздел «Правила учёта»): «Продано» означает, что строку закрыл документ
 * продажи, и строка на него ссылается.
 *
 * Запись со строкой «Продано» политика не отличает от записи действием «Продажа»: так строки
 * переводит само действие. Поэтому она проверяет итог: продажа из строки должна быть оформлена
 * из этого отвеса. Состояние «Продано», выбранное вручную, такой проверки не проходит.
 */
const weighingRules: Policy<WeighingRecord> = {
    name: 'weighing-rules',
    save: ({ proposedRecord }) => Effect.gen(function* () {
        const database = yield* Database;
        for (const [index, line] of proposedRecord.goods.entries()) {
            const place = `Строка ${index + 1}`;
            // Необязательное поле, не переданное в запросе, приходит в политику как `undefined`, а не `null`.
            const saleGuid = line.sale ?? null;
            if (line.state !== sold) {
                if (saleGuid !== null) return yield* rejected(`${place}: на продажу ссылается только строка в состоянии «${sold}»`);
                continue;
            }
            if (saleGuid === null) {
                return yield* rejected(`${place}: состояние «${sold}» ставит действие «Продажа», выбрать его вручную нельзя`);
            }
            const sale = yield* database.get(selectTyped(Sale, {
                columns: ['basis'],
                where: [{ column: 'guid', operator: '=', value: saleGuid }],
                limit: 1,
            }));
            if (sale === undefined || sale.basis !== proposedRecord.guid) {
                return yield* rejected(`${place}: продажа оформлена не из этого отвеса`);
            }
        }
    }),
};

const target = { kind: 'document', name: 'weighing' };

/**
 * Состояние отвеса показывает элемент `WeighingState`; он же выводит кнопку действия «Продажа»
 * с выбором строк и передаёт действию `guid` отвеса. Стандартную кнопку действия элемент скрывает:
 * её окно потребовало бы выбрать отвес и набрать номера строк.
 *
 * Продажу создаёт действие на сервере, а не форма новой продажи: продажа и ссылки на неё
 * в строках отвеса записываются в одной транзакции, и строка не может остаться «Продано» без
 * документа. Обе записи действие выполняет вложенными `save`, а они проверяются по правам того же
 * пользователя, поэтому пользователю нужны права на действие и на запись отвеса и продажи.
 */
export const Weighing = weighing
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Отвес', ['number', 'date', 'shift', 'person', OpenShift, WeighingState])
        .group('Товары', ['goods', 'balance'])
        .hide('heldCount')
        .hide('posted'))
    .policy(weighingRules)
    .action('sell', (action) => action
        .title('Продажа')
        .input((input) => input
            .field('weighing', (field) => field.reference(weighing).title('Отвес').required())
            .tablePart('lines', (part) => part
                .title('Товары')
                .field('lineNumber', (field) => field.number().title('Номер строки').integer().minimum(1).required())))
        .handle((input) => Effect.gen(function* () {
            const database = yield* Database;
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.weighing } })) as WeighingRecord;
            const numbers = input.lines.map((line) => line.lineNumber);
            if (numbers.length === 0) return yield* rejected('Не выбран ни один товар');
            if (new Set(numbers).size !== numbers.length) return yield* rejected('Строка отвеса выбрана больше одного раза');
            const selected = [];
            for (const number of numbers) {
                const line = record.goods[number - 1];
                if (line === undefined) return yield* rejected(`В отвесе нет строки ${number}`);
                if (line.state !== held) return yield* rejected(`Строка ${number} уже не в отвесе: её состояние «${line.state}»`);
                selected.push({ name: line.name, cost: line.cost, discount: line.discount });
            }
            // Продажа относится к смене, в которую оформлена, а не к смене отвеса.
            const shift = yield* database.get(selectTyped(Shift, {
                columns: ['guid'],
                where: [{ column: 'closedAt', operator: '=', value: null }],
                limit: 1,
            }));
            if (shift === undefined) return yield* rejected('Открытой смены нет: продажу не к чему отнести');
            const sale = (yield* dispatcher.execute({
                target: { kind: 'document', name: 'sale' }, action: 'save',
                payload: { fields: { date: new Date().toISOString(), shift: shift.guid, basis: record.guid, goods: selected } },
            })) as { readonly guid: string };
            // Продажа записана раньше отвеса: политика отвеса проверяет, что продажа из строки оформлена из него.
            yield* dispatcher.execute({
                target, action: 'save',
                payload: {
                    guid: record.guid,
                    fields: { ...record, goods: record.goods.map((line, index) => numbers.includes(index + 1) ? { ...line, state: sold, sale: sale.guid } : line) },
                },
            });
            return sale;
        })));
