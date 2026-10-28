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
import type { FilterOperator, ListSort } from '../../../server/ui/descriptions';
import type { ListCondition } from '../../data-provider/data-provider';
import type { PerformTarget } from '../../data-provider/perform';
export { objectReferences } from '../../../common/object-reference';
export type { ObjectReference, ObjectReferenceOf, ObjectReferences } from '../../../common/object-reference';

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
