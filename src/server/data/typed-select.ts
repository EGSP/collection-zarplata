/** Типизированная выборка полей таблицы объекта поверх конструктора SQL, без табличных частей. */
import type { ObjectBuilder, RecordOf } from '../metadata/builders.js';
import type { StandardFields } from '../metadata/standard-fields.js';
import { select, type SqlCondition, type SqlFilter, type SqlOrder } from '../database/sql.builder.js';
import type { TypedSqlQuery } from '../database/typed-query.js';
import { fieldValueFromRow, sqlValue } from './storage-values.js';

/** Имена хранимых полей билдера. Регистратор занимает две колонки и в выборке не поддерживается. */
export type TypedColumn<Builder extends ObjectBuilder> = Exclude<
    (keyof StandardFields[Builder['kind']] | keyof Builder['~fields']) & string, 'recorder'
>;

/** Строка таблицы объекта, выведенная из записи без отдельно хранимых табличных частей и регистратора. */
export type TypedRow<Builder extends ObjectBuilder> = Pick<RecordOf<Builder>, TypedColumn<Builder> & keyof RecordOf<Builder>>;

/** Условие связывает имя колонки с типом её значения; SQL NULL передаётся значением null. */
export type TypedCondition<Builder extends ObjectBuilder> = {
    [Column in keyof TypedRow<Builder> & string]: {
        readonly column: Column;
        readonly operator: SqlCondition['operator'];
        readonly value: TypedRow<Builder>[Column];
    }
}[keyof TypedRow<Builder> & string];

/** Отбор по одному полю или группа условий OR; группы объединяются через AND. */
export type TypedFilter<Builder extends ObjectBuilder> = TypedCondition<Builder> | { readonly any: readonly TypedCondition<Builder>[] };

/** Настройки выборки: все имена проверяются по билдеру, размер и смещение проверяет конструктор SQL. */
export interface TypedSelectOptions<Builder extends ObjectBuilder, Columns extends readonly TypedColumn<Builder>[]> {
    readonly columns?: Columns;
    readonly where?: readonly TypedFilter<Builder>[];
    readonly orderBy?: readonly { readonly column: TypedColumn<Builder>; readonly direction: SqlOrder['direction'] }[];
    readonly limit?: number;
    readonly offset?: number;
}

/**
 * Возвращает готовый запрос для Database.get/all. Тип результата содержит выбранные поля,
 * без columns возвращаются все поля таблицы. Преобразование совпадает с чтением записей:
 * логические значения становятся boolean, JSON полных ссылок становится объектом.
 * Неверные имена, регистратор и пустой перечень колонок отклоняются также при выполнении из JavaScript.
 */
export function selectTyped<Builder extends ObjectBuilder, const Columns extends readonly TypedColumn<Builder>[] = readonly TypedColumn<Builder>[]>(
    builder: Builder,
    options: TypedSelectOptions<NoInfer<Builder>, Columns> = {},
): TypedSqlQuery<Pick<TypedRow<Builder>, Columns[number] & keyof TypedRow<Builder>>> {
    const fields = builder.withStandardFields()['~state'].fields.filter((field) => field.builder['~state'].kind !== 'recorder');
    const names = new Set(fields.map((field) => field.name));
    const checkedColumn = (column: string): string => {
        if (!names.has(column)) throw new Error(`Поле «${column}» недоступно для выборки объекта «${builder.name}»`);
        return column;
    };
    const condition = (filter: TypedCondition<Builder>): SqlCondition => ({
        column: checkedColumn(filter.column), operator: filter.operator, value: sqlValue(filter.value),
    });
    const where: readonly SqlFilter[] | undefined = options.where?.map((filter) => 'any' in filter
        ? { any: filter.any.map(condition) } : condition(filter));
    const columns = (options.columns ?? fields.map((field) => field.name)).map(checkedColumn);
    const query = select(`${builder.kind}_${builder.name}`, {
        columns,
        ...(options.limit === undefined ? {} : { limit: options.limit }),
        ...(options.offset === undefined ? {} : { offset: options.offset }),
        ...(where === undefined ? {} : { where }),
        ...(options.orderBy === undefined ? {} : { orderBy: options.orderBy.map((order) => ({ ...order, column: checkedColumn(order.column) })) }),
    });
    const selectedFields = fields.filter((field) => columns.includes(field.name));
    return {
        ...query,
        decodeRow: (row) => Object.fromEntries(selectedFields.map((field) => [
            field.name, fieldValueFromRow(row[field.name], field.builder['~state'].kind),
        ])) as Pick<TypedRow<Builder>, Columns[number] & keyof TypedRow<Builder>>,
    };
}
