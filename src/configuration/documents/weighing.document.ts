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
import { query } from '../../server/database/sql.builder.js';
import { Database } from '../../server/database/database.effect.js';
import { document, formula, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { PhysicalPersons } from '../catalogs/physical-persons.catalog.js';
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
    .field('person', (field) => field.reference(PhysicalPersons).title('Покупатель').required().width('long'))
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
 * Запись со строкой «Продано» политика не отличает от записи действием `applySale`: так строки
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
                return yield* rejected(`${place}: состояние «${sold}» ставит проведение продажи из отвеса, выбрать его вручную нельзя`);
            }
            const sale = yield* database.get(query(Sale).select({
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
 * Форма отвеса собственная (`weighing-form-layout.tsx`): таблица товаров не выводит стоимость,
 * скидку, итог и «Проведено в 1С». Эти колонки заполняются в продаже, которую открывает кнопка
 * «Продать» записанного отвеса; у новой строки отвеса стоимость равна нулю. Кнопка «Вывесить»
 * переводит выбранные строки «В отвесе» в «Вывешено».
 *
 * Проданными строки отмечает действие `applySale`. Его вызывает проведение продажи из отвеса,
 * и оно выполняется в той же транзакции: строка не может стать «Продано» без проведённой продажи.
 * Отмена проведения продажи вызывает его с пустым перечнем и возвращает строки в отвес. Отвес
 * действие записывает вложенным `save`, а оно проверяется по правам того же пользователя, поэтому
 * проводящему продажу нужны права на действие и на запись отвеса. Форма отвеса стандартных
 * кнопок действий не выводит, поэтому вручную действие не вызывают.
 */
export const Weighing = weighing
    // Элементы ставятся на форму только в группе, а группы выводятся раньше остальных полей.
    // Поэтому шапка тоже собрана в группу: иначе товары оказались бы над ней.
    .form((form) => form
        .group('Отвес', ['number', 'date', 'shift', 'person'])
        .group('Товары', ['goods'])
        // Остаток нужен отбору незакрытых отвесов, а на форме не выводится: стоимость товаров
        // отвеса не вводится и заполняется уже в продаже.
        .hide('balance')
        .hide('heldCount')
        .hide('posted'))
    .policy(weighingRules)
    .action('applySale', (action) => action
        .title('Отметить продажу')
        .input((input) => input
            .field('weighing', (field) => field.reference(weighing).title('Отвес').required())
            .field('sale', (field) => field.reference((): ObjectTarget => Sale).title('Продажа').required())
            .tablePart('lines', (part) => part
                .title('Товары')
                .field('lineNumber', (field) => field.number().title('Номер строки').integer().minimum(1).required())))
        .handle((input) => Effect.gen(function* () {
            const dispatcher = yield* ActionDispatcher;
            const record = (yield* dispatcher.execute({ target, action: 'get', payload: { guid: input.weighing } })) as WeighingRecord;
            const numbers = input.lines.map((line) => line.lineNumber);
            if (new Set(numbers).size !== numbers.length) return yield* rejected('Строка отвеса выбрана больше одного раза');
            for (const number of numbers) {
                const line = record.goods[number - 1];
                if (line === undefined) return yield* rejected(`В отвесе нет строки ${number}`);
                // Строка, уже проданная этой продажей, допустима: так повторное проведение продажи не отклоняется.
                if (line.state !== held && line.sale !== input.sale) return yield* rejected(`Товар «${line.name}» уже не в отвесе: его состояние «${line.state}»`);
            }
            // Строки из перечня становятся проданными этой продажей. Строки, которые раньше продала
            // она же, но в перечень не вошли, возвращаются в отвес: продажа их больше не содержит
            // либо её проведение отменено.
            const goods = record.goods.map((line, index) => numbers.includes(index + 1)
                ? { ...line, state: sold, sale: input.sale }
                : line.sale === input.sale ? { ...line, state: held, sale: null } : line);
            // Продажа к этому моменту записана: политика отвеса проверяет, что строка «Продано»
            // ссылается на продажу, оформленную из этого отвеса.
            return yield* dispatcher.execute({ target, action: 'save', payload: { guid: record.guid, fields: { ...record, goods } } });
        })));
