/**
 * Ссылки на объекты конфигурации с типами: по ним компилятор проверяет имена полей и действий.
 *
 * Описание объекта с сервера (`ObjectView`) типов записи не несёт: оно приходит во время работы.
 * Собственный экран конфигурации знает свой объект заранее, поэтому вместо описания передаёт
 * хукам и компонентам SDK ссылку на объект. Ссылка содержит вид и имя объекта, а в типе несёт
 * тип записи и имена действий, выведенные из билдера объекта. Опечатка в имени колонки, поля
 * отбора или действия становится ошибкой компиляции.
 *
 * Значения из файлов объектов клиент не импортирует: файл объекта тянет за собой билдеры, Effect
 * и обработчики действий, и такой импорт включил бы серверный код в сборку клиента. Поэтому типы
 * берутся импортом только типа, а вид и имя ссылки получаются из пути обращения
 * `Objects.document.sample`, который компилятор сверяет с билдерами.
 */
import type { StandardAction } from '../../server/authorization/rights';
import type { BuildersOf, ListRecordOf, ObjectBuilder, RecordOf } from '../../server/metadata/builders';
import type { FilterOperator, ListSort, ObjectKind } from '../../server/ui/descriptions';
import type { ListCondition } from '../data-provider/data-provider';
import type { PerformTarget } from '../data-provider/perform';
import type { RecordData } from '../data-provider/records';

/**
 * Ссылка на объект конфигурации. Во время работы это вид и имя объекта. Свойства с `~` существуют
 * только на уровне типов: `Row` — строка списка, `Record` — запись с табличными частями,
 * `Action` — имена стандартных и собственных действий.
 */
export interface ObjectReference<
    Kind extends ObjectKind = ObjectKind,
    Name extends string = string,
    Row extends RecordData = RecordData,
    Record extends RecordData = RecordData,
    Action extends string = string,
> extends PerformTarget {
    readonly kind: Kind;
    readonly name: Name;
    readonly '~row': Row;
    readonly '~record': Record;
    readonly '~action': Action;
}

/** Ссылка на объект по типу его билдера. */
export type ObjectReferenceOf<Builder extends ObjectBuilder> = ObjectReference<
    Builder['kind'],
    Builder['name'],
    ListRecordOf<Builder>,
    RecordOf<Builder>,
    StandardAction<Builder['kind']> | Builder['~actions']
>;

/** Ссылки на все объекты конфигурации: вид объекта → имя объекта → ссылка. */
export type ObjectReferences<Modules extends ReadonlyArray<object>> = {
    readonly [Kind in ObjectKind]: {
        readonly [Builder in Extract<BuildersOf<Modules>, { readonly kind: Kind }> as Builder['name']]: ObjectReferenceOf<Builder>;
    };
};

/**
 * Объект, строки списка которого имеют тип `Row`. Подходит и ссылка на объект, и описание
 * с сервера: у описания типа строки нет, и `Row` остаётся общим `RecordData`.
 */
export type ListedObject<Row> = PerformTarget & { readonly '~row'?: Row };

/** Объект, запись которого имеет тип `Record`. У описания с сервера это общий `RecordData`. */
export type ReadObject<Record> = PerformTarget & { readonly '~record'?: Record };

/** Объект с действиями `Action`. У описания с сервера имя действия — любая строка. */
export type ActedObject<Action extends string> = PerformTarget & { readonly '~action'?: Action };

/** Имя поля строки `Row`. У общей записи это любая строка. */
export type FieldName<Row> = keyof Row & string;

/** Сортировка по полю строки `Row`. */
export interface RecordSort<Row> extends ListSort {
    readonly field: FieldName<Row>;
}

/**
 * Условие отбора по полю строки `Row`: имя поля и тип значения проверяются по типу строки.
 * Значение `contains` всегда строка: сервер ищет подстроку в отображаемом значении. У общей
 * записи это обычное условие действия `list`.
 */
export type RecordCondition<Row> = string extends keyof Row
    ? ListCondition
    : {
          readonly [Field in FieldName<Row>]:
              | { readonly field: Field; readonly operator: Exclude<FilterOperator, 'contains'>; readonly value: Row[Field] | null }
              | { readonly field: Field; readonly operator: 'contains'; readonly value: string };
      }[FieldName<Row>];

/**
 * Создаёт ссылки на объекты конфигурации. Вызывается в сгенерированном файле `objects.generated.ts`
 * с типами модулей всех объектов. Перечня объектов у функции нет: ссылка создаётся при обращении
 * `Objects.<вид>.<имя>` из вида и имени в этом пути. Допустимость пути проверяет компилятор по типам
 * билдеров, а генератору реестра не нужно разбирать исходники, чтобы узнать имена объектов.
 *
 * Повторное обращение возвращает ту же ссылку, поэтому её можно указывать в зависимостях хуков.
 */
export function objectReferences<Modules extends ReadonlyArray<object>>(): ObjectReferences<Modules> {
    const kinds = new Map<string, object>();
    const namesOf = (kind: string): object => {
        const references = new Map<string, PerformTarget>();
        return new Proxy(
            {},
            {
                get: (_target, name) => {
                    // Символы запрашивает среда выполнения, например при выводе объекта в консоль: объектов с такими именами нет.
                    if (typeof name !== 'string') return undefined;
                    const reference = references.get(name) ?? Object.freeze({ kind, name });
                    references.set(name, reference);
                    return reference;
                },
            },
        );
    };
    return new Proxy(
        {},
        {
            get: (_target, kind) => {
                if (typeof kind !== 'string') return undefined;
                const names = kinds.get(kind) ?? namesOf(kind);
                kinds.set(kind, names);
                return names;
            },
        },
    ) as ObjectReferences<Modules>;
}
