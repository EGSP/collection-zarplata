/** Календарный день кассы и неизменяемая история ручных отметок сверки. */
import { Context, Effect } from 'effect';
import { accessSchema } from '../../server/authorization/access-schema.js';
import { ActionContext, ActionDispatcher } from '../../server/data/action-context.js';
import { DataPolicyError } from '../../server/data/data.errors.js';
import { ReadonlyDatabase } from '../../server/database/database.effect.js';
import { query } from '../../server/database/sql.builder.js';
import { document, semanticDefaults, type Policy, type RecordOf } from '../../server/metadata/index.js';
import { Users } from '../../server/users/object.js';
import { cashSummary, cashSummaryVersion, type CashSummary } from '../cash-summary.js';
import { nextDay } from '../payroll.js';
import { dayOf, lastClosedThrough } from '../policies/closed-period.js';
import { Refund } from './refund.document.js';
import { SaleInstallment } from './sale-installment.document.js';
import { Sale } from './sale.document.js';
import { Shift } from './shift.document.js';

/** Отсутствие отметки обозначается отсутствием документа, а не третьим значением в истории. */
const reviewStatuses = ['Проверен', 'Есть замечания'] as const;
export type CashDayReviewStatus = (typeof reviewStatuses)[number];

/** Дата документа служит началом суток, отдельная календарная дата нужна для поиска и закрытия периода. */
const cashDay = document('cashDay')
    .title('Кассовый день')
    .field('cashDate', (field) => field.date().title('Кассовый день').required())
    .field('endsAt', (field) => field.dateTime().title('Дата конца').required())
    .field('reviewStatus', (field) => field.string().title('Отметка').choices(reviewStatuses).required())
    .tablePart('reviews', (part) => part
        .title('История сверок')
        .field('status', (field) => field.string().title('Новый статус').choices(reviewStatuses).required())
        .field('appliedAt', (field) => field.dateTime().title('Дата отметки').required().default(semanticDefaults.currentDateTime))
        .field('author', (field) => field.reference(Users).title('Автор').required())
        .field('authorName', (field) => field.string().title('Имя автора').required())
        .field('comment', (field) => field.string().title('Комментарий').maximumLength(1000))
        .field('snapshot', (field) => field.string().title('Снимок сводки').required()))
    .form((form) => form.hide('posted'));

/** Приватное разрешение на вложенную запись выдаёт только действие отметки. */
const ReviewWrite = Context.Service<boolean>('CashDayReviewWrite');

/** Кассовый день не проводится и не удаляется: иначе можно подменить историю или обойти сверку. */
const reviewOnly = () => Effect.fail(new DataPolicyError({ message: 'Кассовый день меняется только действием отметки сверки' }));

/** Политика защищает историю и от стандартной записи с расширенными правами. */
const cashDayPolicy: Policy<RecordOf<typeof cashDay>> = {
    name: 'cash-day-review-only',
    save: () => Effect.gen(function* () {
        const access = yield* Effect.serviceOption(ReviewWrite);
        if (access._tag === 'None') return yield* reviewOnly();
    }),
    post: reviewOnly,
    unpost: reviewOnly,
    markDeleted: reviewOnly,
    unmarkDeleted: reviewOnly,
};

/** Граница хранит полночь в часовом поясе сервера, сохраняя исходную календарную дату. */
function dayStart(day: string): string {
    const midnight = `${day}T00:00:00`;
    const offset = -new Date(midnight).getTimezoneOffset();
    const hours = Math.floor(Math.abs(offset) / 60);
    const minutes = Math.abs(offset) % 60;
    return `${midnight}${offset < 0 ? '-' : '+'}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Сегодняшняя дата по часам сервера, как в правилах закрытия периода. */
const today = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

/** Список отметок не читает снимки: полосе дат нужны только статусы, а форме сверки ещё граница. */
const reviewCalendar = Effect.fnUntraced(function* (firstDate: string, lastDate: string) {
    const database = yield* ReadonlyDatabase;
    const days = yield* database.all(query(cashDay).select({
        columns: ['cashDate', 'reviewStatus'],
        where: [{ column: 'cashDate', operator: '>=', value: firstDate }, { column: 'cashDate', operator: '<=', value: lastDate }],
    }));
    const closedThrough = yield* lastClosedThrough;
    return { days, closedThrough };
});

/** Для чтения дня берёт заголовки сверок без снимков; выбранный снимок читается отдельно. */
const reviewHistory = Effect.fnUntraced(function* (cashDate: string) {
    const database = yield* ReadonlyDatabase;
    const record = yield* database.get(query(cashDay).select({ columns: ['guid'], where: [{ column: 'cashDate', operator: '=', value: cashDate }] }));
    if (record === undefined) return [];
    return yield* database.all(query(cashDay).tablePart('reviews').select({
        columns: ['lineNumber', 'status', 'appliedAt', 'authorName', 'comment'],
        where: [{ column: 'ownerGuid', operator: '=', value: record.guid }],
        orderBy: [{ column: 'lineNumber', direction: 'DESC' }],
    }));
});

/** Возвращает именно сохранённый снимок выбранной сверки, не пересчитывая старые суммы. */
const reviewSnapshot = Effect.fnUntraced(function* (cashDate: string, lineNumber: number) {
    const database = yield* ReadonlyDatabase;
    const record = yield* database.get(query(cashDay).select({ columns: ['guid'], where: [{ column: 'cashDate', operator: '=', value: cashDate }] }));
    if (record === undefined) return null;
    const row = yield* database.get(query(cashDay).tablePart('reviews').select({
        columns: ['snapshot'],
        where: [{ column: 'ownerGuid', operator: '=', value: record.guid }, { column: 'lineNumber', operator: '=', value: lineNumber }],
    }));
    return row === undefined ? null : JSON.parse(row.snapshot) as CashSummary;
});

/** Ночная смена входит в обе даты; смена, закрытая в полночь, не входит в следующие сутки. */
const dayShifts = Effect.fnUntraced(function* (cashDate: string) {
    const database = yield* ReadonlyDatabase;
    const nextDate = nextDay(cashDate);
    const shifts = yield* database.all(query(Shift).select({
        columns: ['guid', 'number', 'date', 'closedAt'],
        where: [
            { column: 'date', operator: '<', value: `${nextDate}T00:00+00:00` },
            { any: [
                { column: 'closedAt', operator: '=', value: null },
                { column: 'closedAt', operator: '>=', value: `${cashDate}T00:00+00:00` },
            ] },
        ],
        orderBy: [{ column: 'date', direction: 'ASC' }],
    }));
    return shifts.filter((shift) => shift.closedAt === null
        || dayOf(shift.closedAt) > cashDate
        || dayOf(shift.closedAt) === cashDate && !/^00:00(?::00(?:\.0+)?)?(?:[+\-Z]|$)/.test(shift.closedAt.slice(11)));
});

/** При первом закрытии не требуются отметки за даты до начала учёта. */
const firstAccountingDay = Effect.fnUntraced(function* (closedThrough: string) {
    const database = yield* ReadonlyDatabase;
    const orderBy = [{ column: 'date', direction: 'ASC' }] as const;
    const active = [{ column: 'posted', operator: '=', value: true }, { column: 'deletedAt', operator: '=', value: null }] as const;
    const shift = yield* database.get(query(Shift).select({ columns: ['date'], orderBy, limit: 1 }));
    const sale = yield* database.get(query(Sale).select({ columns: ['date'], where: active, orderBy, limit: 1 }));
    const refund = yield* database.get(query(Refund).select({ columns: ['date'], where: active, orderBy, limit: 1 }));
    const installment = yield* database.get(query(SaleInstallment).select({ columns: ['date'], where: active, orderBy, limit: 1 }));
    const starts = [shift, sale, refund, installment].flatMap((record) => record === undefined ? [] : [dayOf(record.date)]);
    return [closedThrough, ...starts].sort()[0]!;
});

/** Закрытие проверяет последнюю отметку каждого календарного дня, включая дни без операций. */
export const checkCashDayReviews = Effect.fnUntraced(function* (closedThrough: string) {
    const previous = yield* lastClosedThrough;
    const firstDate = previous === null ? yield* firstAccountingDay(closedThrough) : nextDay(previous);
    const { days } = yield* reviewCalendar(firstDate, closedThrough);
    const statuses = new Map(days.map((day) => [day.cashDate, day.reviewStatus]));
    const missing: string[] = [];
    const remarks: string[] = [];
    for (let date = firstDate; date <= closedThrough; date = nextDay(date)) {
        const status = statuses.get(date);
        if (status === undefined) missing.push(date);
        else if (status === 'Есть замечания') remarks.push(date);
    }
    const reasons = [
        missing.length === 0 ? '' : `Не проверены: ${missing.join(', ')}`,
        remarks.length === 0 ? '' : `Есть замечания: ${remarks.join(', ')}`,
    ].filter(Boolean);
    if (reasons.length > 0) return yield* new DataPolicyError({ message: `Сверьте кассовые дни перед закрытием периода. ${reasons.join('. ')}` });
});

/** Вложенное действие получает право записать кассовый день и прочитать имя автора. */
const reviewAccess = accessSchema()
    .object(cashDay, (access) => access.level('edit'))
    .object(Users, (access) => access.field('guid', 'read').field('name', 'read'));

/** Сохраняет снимок, рассчитанный сервером, только если он совпадает с открытой сводкой. */
const recordReview = Effect.fnUntraced(function* (input: {
    readonly cashDate: string;
    readonly status: string;
    readonly comment: string | null;
    readonly summaryVersion: string;
}) {
    const { cashDate, status, summaryVersion } = input;
    const comment = input.comment?.trim() || null;
    if (cashDate > today()) return yield* new DataPolicyError({ message: 'Нельзя сверить будущий кассовый день' });
    const closedThrough = yield* lastClosedThrough;
    if (closedThrough !== null && cashDate <= closedThrough) {
        return yield* new DataPolicyError({ message: `Период закрыт по ${closedThrough} включительно` });
    }
    if (status === 'Есть замечания' && comment === null) {
        return yield* new DataPolicyError({ message: 'Укажите замечание к кассовому дню' });
    }
    const snapshot = yield* cashSummary(cashDate);
    if ((yield* cashSummaryVersion(snapshot)) !== summaryVersion) {
        return yield* new DataPolicyError({ message: 'Сводка изменилась. Обновите данные и проверьте их перед отметкой' });
    }
    const { userGuid } = yield* ActionContext;
    if (userGuid === null) return yield* reviewOnly();
    const database = yield* ReadonlyDatabase;
    const record = yield* database.get(query(cashDay).select({ columns: ['guid'], where: [{ column: 'cashDate', operator: '=', value: cashDate }] }));
    const dispatcher = yield* ActionDispatcher;
    const target = { kind: cashDay.kind, name: cashDay.name };
    const existing = record === undefined ? null : (yield* dispatcher.execute({ target, action: 'get', payload: { guid: record.guid } })) as RecordOf<typeof cashDay>;
    const author = yield* database.get(query(Users).select({ columns: ['name'], where: [{ column: 'guid', operator: '=', value: userGuid }] }));
    yield* dispatcher.execute({
        target,
        action: 'save',
        payload: {
            ...(existing === null ? {} : { guid: existing.guid }),
            fields: {
                date: dayStart(cashDate), cashDate, endsAt: dayStart(nextDay(cashDate)), reviewStatus: status,
                reviews: [...(existing?.reviews ?? []), { status, comment, author: userGuid, authorName: author?.name || userGuid, appliedAt: new Date().toISOString(), snapshot: JSON.stringify(snapshot) }],
            },
        },
    }).pipe(Effect.provideService(ReviewWrite, true));
});

/** Действие «Отметить сверку» вызывается только со вкладки «Касса», не из стандартной формы. */
export const CashDay = cashDay.policy(cashDayPolicy)
    .function('dayShifts', (entry) => entry.title('Смены кассового дня')
        .input((input) => input.field('cashDate', (field) => field.date().required()))
        .handle(({ cashDate }) => dayShifts(cashDate)))
    .function('reviewCalendar', (entry) => entry.title('Отметки кассовых дней')
        .input((input) => input.field('firstDate', (field) => field.date().required()).field('lastDate', (field) => field.date().required()))
        .handle(({ firstDate, lastDate }) => reviewCalendar(firstDate, lastDate)))
    .function('reviewHistory', (entry) => entry.title('История сверок')
        .input((input) => input.field('cashDate', (field) => field.date().required()))
        .handle(({ cashDate }) => reviewHistory(cashDate)))
    .function('reviewSnapshot', (entry) => entry.title('Снимок сверки')
        .input((input) => input.field('cashDate', (field) => field.date().required()).field('lineNumber', (field) => field.number().integer().minimum(1).required()))
        .handle(({ cashDate, lineNumber }) => reviewSnapshot(cashDate, lineNumber)))
    .action('recordReview', (entry) => entry.title('Отметить сверку').placement('hidden').access(reviewAccess)
        .input((input) => input
            .field('cashDate', (field) => field.date().required())
            .field('status', (field) => field.string().choices(reviewStatuses).required())
            .field('comment', (field) => field.string().maximumLength(1000))
            .field('summaryVersion', (field) => field.string().minimumLength(64).maximumLength(64).required()))
        .handle(recordReview));
