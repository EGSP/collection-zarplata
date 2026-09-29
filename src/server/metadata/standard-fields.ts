/**
 * Стандартные поля видов объектов — единственное место, где они заданы.
 *
 * Сервис метаданных добавляет их билдеру методом `withStandardFields()` перед `commit()`, а тип
 * записи объекта включает их заранее: `ObjectRecord` берёт типы прямо из этого объекта. Поэтому
 * поля заданы значением с `as const`, а не собираются во время выполнения, иначе TypeScript
 * не узнал бы их имена и типы.
 */
import type { ObjectKind } from './descriptions.js';
import { fieldFactory as field, standardFieldFactory, type AnyFieldBuilder } from './fields.js';

/** Стандартные поля по видам объектов. Длины кода, наименования и номера предварительные. */
export const standardFields = {
    catalog: {
        guid: standardFieldFactory.guid().title('Идентификатор').required(),
        deletedAt: field.dateTime().title('Пометка удаления'),
        code: field.string().title('Код').maximumLength(50),
        name: field.string().title('Наименование').required().maximumLength(200),
    },
    document: {
        guid: standardFieldFactory.guid().title('Идентификатор').required(),
        deletedAt: field.dateTime().title('Пометка удаления'),
        number: field.string().title('Номер').required().maximumLength(50),
        // Дата документа хранится с временем: документы одного дня упорядочиваются по нему.
        date: field.dateTime().title('Дата').required(),
        posted: field.boolean().title('Проведён').required(),
    },
    // У строк регистра нет guid и пометки удаления: строку определяют регистратор и номер строки,
    // а при отмене проведения строки удаляются вместе с документом-регистратором.
    register: {
        recorder: standardFieldFactory.recorder().title('Регистратор').required(),
        period: field.dateTime().title('Период').required(),
        lineNumber: field.number().title('Номер строки').integer().minimum(1).required(),
    },
} as const satisfies { readonly [Kind in ObjectKind]: { readonly [name: string]: AnyFieldBuilder } };

/** Тип набора стандартных полей; из него выводится часть типа записи. */
export type StandardFields = typeof standardFields;

/**
 * Стандартные поля, значения которых заполняет платформа: их нет во входных данных записи.
 * `code`, `name`, `date` и `period` сюда не входят — их задаёт пользователь или обработчик проведения.
 */
export const managedStandardFields: ReadonlySet<string> = new Set(['guid', 'deletedAt', 'number', 'posted', 'recorder', 'lineNumber']);

/**
 * Стандартные поля, которых нет на форме объекта: `guid` пользователю ничего не говорит,
 * а пометку удаления ставят и снимают отдельные действия. Переопределение формы не может
 * вывести эти поля в группу.
 */
export const formHiddenStandardFields: ReadonlySet<string> = new Set(['guid', 'deletedAt']);
