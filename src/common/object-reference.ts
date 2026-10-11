/**
 * Ссылки на объекты без зависимости от клиента. Объявления компонентов читаются и сервером,
 * поэтому ссылка несёт только вид, имя и типы, а не загружает SDK или файл объекта.
 */
import type { StandardAction } from '../server/authorization/rights.js';
import type { BuildersOf, ListRecordOf, ObjectBuilder, RecordOf } from '../server/metadata/builders.js';
import type { ObjectKind } from '../server/metadata/descriptions.js';

/** Ссылка на объект; свойства с `~` существуют только в типах. */
export interface ObjectReference<Kind extends ObjectKind = ObjectKind, Name extends string = string,
    Row extends Record<string, unknown> = Record<string, unknown>,
    RecordValue extends Record<string, unknown> = Record<string, unknown>, Action extends string = string> {
    readonly kind: Kind;
    readonly name: Name;
    readonly '~row': Row;
    readonly '~record': RecordValue;
    readonly '~action': Action;
}

/** Ссылка с полями и действиями, выведенными из билдера объекта. */
export type ObjectReferenceOf<Builder extends ObjectBuilder> = ObjectReference<Builder['kind'], Builder['name'],
    ListRecordOf<Builder>, RecordOf<Builder>, StandardAction<Builder['kind']> | Builder['~actions']>;

/** Ссылки конфигурации: вид объекта, затем имя объекта. */
export type ObjectReferences<Modules extends ReadonlyArray<object>> = {
    readonly [Kind in ObjectKind]: {
        readonly [Builder in Extract<BuildersOf<Modules>, { readonly kind: Kind }> as Builder['name']]: ObjectReferenceOf<Builder>;
    };
};

/** Создаёт устойчивые ссылки по пути обращения; допустимость пути проверяют типы модулей. */
export function objectReferences<Modules extends ReadonlyArray<object>>(): ObjectReferences<Modules> {
    const kinds = new Map<string, object>();
    return new Proxy({}, {
        get: (_target, kind) => {
            if (typeof kind !== 'string') return undefined;
            let names = kinds.get(kind);
            if (names === undefined) {
                const references = new Map<string, object>();
                names = new Proxy({}, {
                    get: (_names, name) => {
                        if (typeof name !== 'string') return undefined;
                        const reference = references.get(name) ?? Object.freeze({ kind, name });
                        references.set(name, reference);
                        return reference;
                    },
                });
                kinds.set(kind, names);
            }
            return names;
        },
    }) as ObjectReferences<Modules>;
}
