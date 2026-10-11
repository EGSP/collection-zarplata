/** Объявления подключений компонентов формы. Сервер читает объявления без React и DOM. */
import type { ObjectReference } from '../../common/object-reference.js';

/** Имена табличных частей в типе записи объекта. */
type PartNames<RecordValue> = string extends keyof RecordValue ? string : { [Name in keyof RecordValue]: RecordValue[Name] extends ReadonlyArray<unknown> ? Name : never }[keyof RecordValue] & string;

/** Имена полей шапки, в отличие от табличных частей. */
type HeaderNames<RecordValue> = string extends keyof RecordValue ? string : Exclude<keyof RecordValue & string, PartNames<RecordValue>>;

/** Место замены: ровно одно поле шапки либо одна табличная часть. */
export type FormComponentOverride<Object extends ObjectReference = ObjectReference> = { readonly object: Object } & (
    | { readonly field: HeaderNames<Object['~record']>; readonly tablePart?: never }
    | { readonly tablePart: PartNames<Object['~record']>; readonly field?: never }
);

/** Вставка блока в существующую группу; без after блок ставится в начало группы. */
export interface FormComponentInsert<Object extends ObjectReference = ObjectReference> {
    readonly object: Object;
    readonly group: string;
    readonly after?: keyof Object['~record'] & string;
}

/** Одно подключение компонента. Замена и вставка взаимоисключающие. */
export type FormComponentAttachment<Object extends ObjectReference = ObjectReference> =
    | { readonly override: FormComponentOverride<Object>; readonly insert?: never }
    | { readonly insert: FormComponentInsert<Object>; readonly override?: never };

/** Объявление компонента с одним или несколькими местами подключения на формах. */
export class FormComponentDefinition<Name extends string = string> {
    constructor(readonly name: Name, readonly attachments: ReadonlyArray<FormComponentAttachment>) {}
}

/** Ссылка конкретного подключения; у каждого места в массиве свой тип записи. */
type AttachmentObject<Attachment> = Attachment extends { readonly override: { readonly object: infer Object extends ObjectReference } }
    ? Object : Attachment extends { readonly insert: { readonly object: infer Object extends ObjectReference } } ? Object : ObjectReference;

/** Объявляет компонент с одним подключением. Типы проверяют имена полей; сервер проверяет места и конфликты. */
export function defineFormComponent<const Name extends string, const Object extends ObjectReference>(
    definition: { readonly name: Name } & FormComponentAttachment<Object>,
): FormComponentDefinition<Name>;
/** Объявляет несколько подключений; имена полей проверяются отдельно для объекта каждого места. */
export function defineFormComponent<const Name extends string, const Attachments extends ReadonlyArray<FormComponentAttachment>>(
    definition: { readonly name: Name; readonly attachments: Attachments & { readonly [Index in keyof Attachments]: FormComponentAttachment<AttachmentObject<Attachments[Index]>> } },
): FormComponentDefinition<Name>;
export function defineFormComponent(
    definition: { readonly name: string } & (FormComponentAttachment | { readonly attachments: ReadonlyArray<FormComponentAttachment> }),
): FormComponentDefinition {
    const attachments = 'attachments' in definition ? definition.attachments : [definition];
    return new FormComponentDefinition(definition.name, attachments);
}

/** Отличает объявление компонента от вспомогательных экспортов файла. */
export function isFormComponentDefinition(value: unknown): value is FormComponentDefinition {
    return value instanceof FormComponentDefinition;
}
