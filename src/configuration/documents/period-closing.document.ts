/**
 * Закрытие периода: проведённая запись устанавливает границу закрытого учётного периода
 * включительно и фиксирует начисление зарплаты за период. Документы с датой в закрытом периоде
 * больше не меняются (политика `closed-period.ts`), а начисление хранится строками документа
 * и не пересчитывается, даже если правила расчёта изменятся.
 *
 * Начисление хранится в самом закрытии, а не в отдельном документе: отмена проведения одного
 * документа и открывает период, и снимает начисление, поэтому граница и начисление не расходятся.
 */
import { Effect } from 'effect';
import { ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { Database } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { formula, type ObjectTarget, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { Employees } from '../catalogs/employees.catalog.js';
import { ownInstallment } from '../installments.js';
import { numberAndDate } from '../money.js';
import { periodClosingHead } from '../period-closing.js';
import { calculatePayroll, type PayrollResult } from '../payroll.js';
import { periodSummary } from '../period-summary.js';
import { dayOf, lastClosedThrough } from '../policies/closed-period.js';
import { preventPostedDocumentDeletion } from '../policies/posted-document-deletion.js';
import { SaleInstallment } from './sale-installment.document.js';
import { Sale } from './sale.document.js';
import { Shift } from './shift.document.js';

/**
 * Описание без политики и действий: они читают таблицу самого документа, а ссылка на
 * `PeriodClosing` из его же объявления не дала бы вывести тип.
 *
 * Строка начисления ссылается на документ-источник полной ссылкой с видом: им бывает продажа,
 * рассрочка по продаже, возврат или смена. Текст правила сохраняется в строке: по нему видно,
 * почему начислена сумма, даже после смены правил.
 */
const closing = periodClosingHead
    .field('periodStart', (field) => field.date().title('Начало периода'))
    .field('rules', (field) => field.string().title('Правила расчёта').maximumLength(200))
    .field('amount', (field) => field.money().title('Начислено').required().computed(formula.sum('employees', 'amount')))
    .tablePart('employees', (part) => part
        .title('Сотрудники')
        .field('employee', (field) => field.reference(Employees).title('Сотрудник').required())
        .field('amount', (field) => field.money().title('Начислено').required()))
    .tablePart('lines', (part) => part
        .title('Расшифровка')
        .field('employee', (field) => field.reference(Employees).title('Сотрудник').required())
        .field('date', (field) => field.dateTime().title('Дата').required())
        .field('kind', (field) => field.string().title('Вид').required().maximumLength(50))
        .field('document', (field) => field.reference().title('Документ').required())
        // У бонуса смены нет продажи, товара и ставки: он начисляется на смену фиксированной суммой.
        .field('sale', (field) => field.reference(Sale).title('Продажа'))
        .field('goods', (field) => field.string().title('Товар').maximumLength(300))
        .field('base', (field) => field.money().title('База').required())
        .field('rate', (field) => field.number().title('Ставка, %'))
        .field('amount', (field) => field.money().title('Начислено').required())
        .field('rule', (field) => field.string().title('Правило').required().maximumLength(500))
        // Дата открытия рассрочки у строк по рассрочке: у собственной она раньше даты начисления.
        // Строки закрытий, записанных до появления поля, её не хранят.
        .field('installmentDate', (field) => field.dateTime().title('Рассрочка открыта'))
        .field('installmentClosedAt', (field) => field.dateTime().title('Рассрочка закрыта')))
    .listTableParts(['employees']);

type ClosingRecord = RecordOf<typeof closing>;

const rejected = (message: string) => new DataPolicyError({ message });

/** Текущий день по часам сервера датой `ГГГГ-ММ-ДД`: закрыть период им нельзя. */
const today = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Отбор действующих проведённых документов. */
const active = [
    { column: 'posted', operator: '=', value: true },
    { column: 'deletedAt', operator: '=', value: null },
] as const;

/**
 * Условия закрытия по день `closedThrough` (раздел «Правила учёта», «Закрытие периода»).
 *
 * Открытая смена и погашенная, но не закрытая собственная рассрочка в пределах периода изменили бы
 * расчёт после закрытия: продажа открытой смены ещё может появиться, а рассрочку закрыли бы датой,
 * которая уже в закрытом периоде, и её политика это отклонила бы. Поэтому их нужно закрыть до расчёта.
 */
const checkClosingConditions = (closedThrough: string) => Effect.gen(function* () {
    if (closedThrough >= today()) return yield* rejected('Период закрывается только прошедшим днём: сегодняшний день ещё не закончился');
    const previous = yield* lastClosedThrough;
    if (previous !== null && closedThrough <= previous) return yield* rejected(`Период уже закрыт по ${previous}: новая граница должна быть позже`);
    const database = yield* Database;
    const openShifts = (yield* database.all(query(Shift).select({
        columns: ['number', 'date'],
        where: [{ column: 'closedAt', operator: '=', value: null }],
    }))).filter((shift) => dayOf(shift.date) <= closedThrough);
    if (openShifts.length > 0) return yield* rejected(`Смена ${numberAndDate(openShifts[0]!)} не закрыта: закройте её до закрытия периода`);
    const repaid = yield* database.all(query(SaleInstallment).select({
        columns: ['guid', 'number', 'date'],
        where: [...active, { column: 'type', operator: '=', value: ownInstallment }, { column: 'closedAt', operator: '=', value: null }, { column: 'balance', operator: '=', value: 0 }],
    }));
    if (repaid.length === 0) return;
    const payments = yield* database.all(query(SaleInstallment).tablePart('payments').select({
        columns: ['ownerGuid', 'date'],
        where: [{ column: 'ownerGuid', operator: 'IN', value: repaid.map((installment) => installment.guid) }],
    }));
    // Рассрочка погашена в день последнего взноса: если он в периоде, её нужно закрыть до расчёта.
    const unclosed = repaid.filter((installment) => payments.some((payment) => payment.ownerGuid === installment.guid && dayOf(payment.date) <= closedThrough));
    if (unclosed.length > 0) {
        return yield* rejected(`Погашенные рассрочки не закрыты: ${unclosed.map(numberAndDate).join(', ')}. Закройте их датой последнего взноса до закрытия периода`);
    }
});

/** Строка начисления для сравнения: значения по порядку, дата моментом. */
const lineKey = (line: ClosingRecord['lines'][number] | PayrollResult['lines'][number]): string => JSON.stringify([
    line.employee, new Date(line.date).getTime(), line.kind, line.document.kind, line.document.name, line.document.guid,
    line.sale ?? null, line.goods ?? null, line.base, line.rate ?? null, line.amount, line.rule,
]);

/**
 * Сверяет начисление записи с расчётом по её границе. Проведение не пересчитывает начисление само:
 * документ хранит то, что увидел администратор при закрытии. Расхождение означает, что данные
 * изменились между расчётом и проведением или что строки введены вручную.
 */
const checkPayroll = (record: ClosingRecord) => Effect.gen(function* () {
    const calculated = yield* calculatePayroll(record.closedThrough);
    const sameStart = (record.periodStart ?? null) === calculated.periodStart;
    const sameLines = JSON.stringify(record.lines.map(lineKey).sort()) === JSON.stringify(calculated.lines.map(lineKey).sort());
    const totals = (rows: ReadonlyArray<{ readonly employee: string; readonly amount: number }>) => JSON.stringify(rows.map((row) => [row.employee, row.amount]).sort());
    if (!sameStart || !sameLines || totals(record.employees) !== totals(calculated.employees)) {
        return yield* rejected('Начисление не совпадает с расчётом зарплаты по эту дату: закройте период действием «Закрыть период»');
    }
});

/**
 * Правила закрытия. Проведённое закрытие не изменяется: его начисление зафиксировано. Отменить
 * проведение можно только у последнего закрытия: иначе внутри закрытого периода появился бы
 * открытый промежуток, а начисления следующих закрытий посчитаны без его документов.
 */
const closingRules: Policy<ClosingRecord> = {
    name: 'period-closing-rules',
    save: ({ existingRecord }) => existingRecord !== null && existingRecord.posted
        ? Effect.fail(rejected('Проведённое закрытие периода не изменяется: отмените проведение и закройте период заново'))
        : Effect.void,
    post: ({ document }) => Effect.gen(function* () {
        yield* checkClosingConditions(document.closedThrough);
        yield* checkPayroll(document);
    }),
    unpost: ({ document }) => Effect.gen(function* () {
        const database = yield* Database;
        const later = yield* database.get(query(closing).select({
            columns: ['closedThrough'],
            where: [...active, { column: 'closedThrough', operator: '>', value: document.closedThrough }],
            limit: 1,
        }));
        if (later !== undefined) return yield* rejected(`Есть более позднее закрытие по ${later.closedThrough}: сначала отмените его`);
    }),
};

const target: ObjectTarget = { kind: 'document', name: 'periodClosing' };

/**
 * Начисление на форме только для просмотра: строки создаёт действие «Закрыть период», а проведение
 * сверяет их с расчётом.
 *
 * Действие «Закрыть период» считает зарплату по заданный день и в одной транзакции записывает
 * и проводит закрытие с начислением. Проведение проверяет условия закрытия, поэтому отказ
 * не оставляет черновика. Действие «Расчёт зарплаты» только читает: оно показывает начисление
 * незакрытого периода по выбранный день, по умолчанию по сегодняшний, на странице «Зарплата».
 */
export const PeriodClosing = closing
    .form((form) => form
        .group('Закрытие', ['number', 'date', 'closedThrough', 'periodStart', 'rules', 'amount'])
        .group('Сотрудники', ['employees'])
        .group('Расшифровка', ['lines'])
        .hide('posted'))
    .policy(closingRules)
    .policy(preventPostedDocumentDeletion())
    .action('closePeriod', (action) => action
        .title('Закрыть период')
        .input((input) => input.field('closedThrough', (field) => field.date().title('Закрыть по').required()))
        .handle((input) => Effect.gen(function* () {
            // Условия проверяются и здесь, до расчёта: отказ называет причину, а не расхождение начисления.
            yield* checkClosingConditions(input.closedThrough);
            const payroll = yield* calculatePayroll(input.closedThrough);
            const dispatcher = yield* ActionDispatcher;
            return yield* dispatcher.execute({
                target, action: 'save',
                payload: {
                    post: true,
                    fields: {
                        date: new Date().toISOString(),
                        closedThrough: payroll.closedThrough,
                        periodStart: payroll.periodStart,
                        rules: payroll.rules,
                        employees: payroll.employees,
                        lines: payroll.lines,
                    },
                },
            });
        })))
    .action('payrollPreview', (action) => action
        .title('Расчёт зарплаты')
        // День расчёта необязателен: без него расчёт идёт по сегодняшний день включительно.
        .input((input) => input.field('closedThrough', (field) => field.date().title('Рассчитать по')))
        .handle((input) => calculatePayroll(input.closedThrough ?? today())))
    // Отчёт о продажах, взносах, отвесах и должниках за период; только читает. Действие стоит здесь,
    // потому что у страниц нет своих действий, а закрытие периода объединяет отчёты по периоду.
    .action('periodSummary', (action) => action
        .title('Сводка за период')
        .input((input) => input
            // Не `from` и `to`: платформа не принимает имён, совпадающих с ключевыми словами SQL.
            .field('periodStart', (field) => field.date().title('С').required())
            .field('periodEnd', (field) => field.date().title('По').required()))
        .handle((input) => input.periodStart > input.periodEnd
            ? Effect.fail(rejected('Начало периода позже его конца'))
            : periodSummary(input.periodStart, input.periodEnd)));
