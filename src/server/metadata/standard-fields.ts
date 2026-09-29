import type { ObjectKind } from './descriptions.js';
import { fieldFactory as field, standardFieldFactory, type AnyFieldBuilder } from './fields.js';

/**
 * Стандартные поля видов объектов — единственное место, где они заданы.
 * Сервис метаданных добавляет их построителю методом `withStandardFields()` перед `commit()`,
 * а тип записи объекта включает их заранее.
 */
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
        date: field.dateTime().title('Дата').required(),
        posted: field.boolean().title('Проведён').required(),
    },
    /** У движений регистра нет `guid` и пометки удаления: строку определяют регистратор и номер строки. */
    register: {
        recorder: standardFieldFactory.recorder().title('Регистратор').required(),
        period: field.dateTime().title('Период').required(),
        lineNumber: field.number().title('Номер строки').integer().minimum(1).required(),
    },
} as const satisfies { readonly [Kind in ObjectKind]: { readonly [name: string]: AnyFieldBuilder } };

export type StandardFields = typeof standardFields;

/** Стандартные поля, значения которых заполняет платформа, а не входные данные действия. */
export const managedStandardFields: ReadonlySet<string> = new Set(['guid', 'deletedAt', 'number', 'posted', 'recorder', 'lineNumber']);
